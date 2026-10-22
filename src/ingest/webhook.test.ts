import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { repos, webhookDeliveries } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { handleGitHubWebhook, verifySignature } from "./webhook";

const db = testDb();
const SECRET = "s3cret";
const AFTER = "f".repeat(40);

describe("verifySignature", () => {
  it("matches GitHub's documented test vector", () => {
    expect(
      verifySignature(
        "It's a Secret to Everybody",
        "Hello, World!",
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      ),
    ).toBe(true);
  });

  it.each([
    ["a wrong digest", "sha256=857107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"],
    ["a truncated digest", "sha256=757107ea"],
    ["the sha1 header format", "sha1=757107ea0eb2509fc211221cce984b8a37570b6d"],
    ["no header", null],
  ])("rejects %s", (_name, header) => {
    expect(verifySignature("It's a Secret to Everybody", "Hello, World!", header)).toBe(false);
  });
});

describe("handleGitHubWebhook", () => {
  beforeEach(resetDb);

  const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const push = (ref: string, extra: object = {}) =>
    JSON.stringify({ ref, after: AFTER, deleted: false, repository: { name: "Widgets", owner: { login: "ACME" } }, ...extra });
  const headers = (body: string, delivery = crypto.randomUUID(), event = "push") =>
    new Headers({ "x-hub-signature-256": sign(body), "x-github-delivery": delivery, "x-github-event": event });

  async function setup() {
    const enqueued: string[] = [];
    const [repo] = await db
      .insert(repos)
      .values({ owner: "acme", name: "widgets", defaultBranch: "main", desiredSha: "a".repeat(40), syncedSha: "a".repeat(40) })
      .returning();
    return { repo, enqueued, deps: { db, secret: SECRET, enqueueSync: async (id: string) => enqueued.push(id) } };
  }

  it("is a 404 when no secret is configured", async () => {
    const body = push("refs/heads/main");
    expect(await handleGitHubWebhook({ db, secret: undefined, enqueueSync: async () => {} }, body, headers(body))).toMatchObject({ status: 404 });
  });

  it("401s a bad signature and records nothing", async () => {
    const { deps, enqueued } = await setup();
    const body = push("refs/heads/main");
    const h = headers(body);
    h.set("x-hub-signature-256", sign(body + " "));
    expect(await handleGitHubWebhook(deps, body, h)).toMatchObject({ status: 401 });
    expect(await db.select().from(webhookDeliveries)).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("a push to the default branch sets desired_sha and enqueues a sync (202)", async () => {
    const { deps, enqueued, repo } = await setup();
    const body = push("refs/heads/main");
    expect(await handleGitHubWebhook(deps, body, headers(body))).toEqual({ status: 202, body: "queued" });
    expect(enqueued).toEqual([repo.id]);
    const [row] = await db.select().from(repos).where(eq(repos.id, repo.id));
    expect(row).toMatchObject({ desiredSha: AFTER, status: "queued" });
  });

  it("dedupes a redelivery by X-GitHub-Delivery", async () => {
    const { deps, enqueued } = await setup();
    const body = push("refs/heads/main");
    const id = crypto.randomUUID();
    await handleGitHubWebhook(deps, body, headers(body, id));
    expect(await handleGitHubWebhook(deps, body, headers(body, id))).toEqual({ status: 200, body: "duplicate" });
    expect(enqueued).toHaveLength(1);
  });

  it.each([
    ["a non-default branch", push("refs/heads/feature")],
    ["a tag", push("refs/tags/v1.0.0")],
    ["a branch deletion", push("refs/heads/main", { deleted: true })],
    ["a repo that was never added", push("refs/heads/main", { repository: { name: "other", owner: { login: "acme" } } })],
  ])("ignores %s", async (_name, body) => {
    const { deps, enqueued, repo } = await setup();
    expect(await handleGitHubWebhook(deps, body, headers(body))).toEqual({ status: 202, body: "ignored" });
    expect(enqueued).toEqual([]);
    const [row] = await db.select().from(repos).where(eq(repos.id, repo.id));
    expect(row.desiredSha).toBe("a".repeat(40));
  });

  it("a delivery that fails to enqueue stays redeliverable", async () => {
    const { repo, deps } = await setup();
    const body = push("refs/heads/main");
    const delivery = crypto.randomUUID();
    const failing = { ...deps, enqueueSync: async () => Promise.reject(new Error("queue down")) };

    await expect(handleGitHubWebhook(failing, body, headers(body, delivery))).rejects.toThrow("queue down");
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, delivery))).toHaveLength(0);

    expect(await handleGitHubWebhook(deps, body, headers(body, delivery))).toMatchObject({ status: 202, body: "queued" });
    expect((await db.select().from(repos).where(eq(repos.id, repo.id)))[0].desiredSha).toBe(AFTER);
  });

  it("acks non-push events without acting", async () => {
    const { deps, enqueued } = await setup();
    const body = JSON.stringify({ zen: "hi" });
    expect(await handleGitHubWebhook(deps, body, headers(body, undefined, "ping"))).toEqual({ status: 202, body: "ignored" });
    expect(enqueued).toEqual([]);
  });

  it("does not flip a running sync back to queued", async () => {
    const { deps, repo } = await setup();
    await db.update(repos).set({ status: "syncing" }).where(eq(repos.id, repo.id));
    const body = push("refs/heads/main");
    await handleGitHubWebhook(deps, body, headers(body));
    const [row] = await db.select().from(repos).where(eq(repos.id, repo.id));
    expect(row).toMatchObject({ status: "syncing", desiredSha: AFTER });
  });
});
