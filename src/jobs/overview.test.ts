import { beforeEach, describe, expect, it } from "vitest";
import { agentRuns, pageRevisions, pages, repos, revisionSources, wikiLog } from "@/db/schema";
import { jobsOverviewSchema } from "@/core/api-schemas";
import { resetDb, testDb } from "@/test/db";
import { getJobsOverview } from "./overview";

const db = testDb();

describe("getJobsOverview", () => {
  beforeEach(resetDb);

  it("reports repos, runs newest first, activity with repo names, and the total spend", async () => {
    const [repo] = await db.insert(repos).values({ owner: "acme", name: "widgets", status: "syncing" }).returning();
    await db.insert(agentRuns).values([
      { kind: "author", model: "m", status: "succeeded", costUsd: "0.25", startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:05:00Z") },
      { kind: "chat", model: "m", status: "running", costUsd: "0.01", startedAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    await db.insert(wikiLog).values({ actor: "agent", action: "repo.synced", repoId: repo.id, details: { indexed: 3 } });

    const o = await getJobsOverview(db);

    expect(o.pipelines).toEqual([expect.objectContaining({ fullName: "acme/widgets", sync: expect.objectContaining({ state: "running" }) })]);
    expect(o.runs.map((r) => [r.kind, r.status, r.costUsd, r.finishedAt])).toEqual([
      ["chat", "running", 0.01, null],
      ["author", "succeeded", 0.25, "2026-01-01T00:05:00.000Z"],
    ]);
    expect(o.activity).toEqual([expect.objectContaining({ action: "repo.synced", repo: "acme/widgets", details: { indexed: 3 } })]);
    expect(o.totalCostUsd).toBeCloseTo(0.26);
    expect(Array.isArray(o.jobs)).toBe(true);
    // The route returns this as JSON and the client parses it with the schema: the round trip must hold.
    expect(jobsOverviewSchema.safeParse(JSON.parse(JSON.stringify(o))).success).toBe(true);
  });

  it("is empty, not an error, on a fresh database", async () => {
    const o = await getJobsOverview(db);
    expect(o).toMatchObject({ pipelines: [], runs: [], activity: [], totalCostUsd: 0 });
  });
});

describe("repo pipelines", () => {
  beforeEach(resetDb);

  it("links a repo to its sync, its author run's progress and its pending proposals", async () => {
    const [repo] = await db
      .insert(repos)
      .values({ owner: "acme", name: "api", role: "API", status: "idle", syncedSha: "a".repeat(40) })
      .returning();
    const [run] = await db.insert(agentRuns).values({ kind: "author", model: "m", status: "running", inputTokens: 900, outputTokens: 100, costUsd: "0.05" }).returning();
    const log = (action: string, details: Record<string, unknown>) => ({ actor: "agent" as const, action, repoId: repo.id, details });
    await db.insert(wikiLog).values([
      log("repo.synced", { indexed: 72, embedded: 300, secretsDropped: [{ path: ".env.example", rules: ["generic"] }] }),
      log("author.started", { runId: run.id }),
      log("author.outline", { runId: run.id, planned: 4 }),
      log("author.page_started", { runId: run.id, path: "Overview" }),
      log("author.page_proposed", { runId: run.id, path: "Overview" }),
      log("author.page_dropped", { runId: run.id, path: "Glossary" }),
      log("author.page_skipped", { runId: run.id, path: "Guides", reason: "exists" }),
      log("author.page_started", { runId: run.id, path: "Architecture" }),
    ]);
    const [page] = await db.insert(pages).values({ title: "Overview" }).returning();
    const [rev] = await db.insert(pageRevisions).values({ pageId: page.id, title: "Overview", bodyMd: "x", authorKind: "agent", status: "proposed" }).returning();
    await db.insert(revisionSources).values({ revisionId: rev.id, repoId: repo.id, path: "src/a.ts", commitSha: "a".repeat(40) });

    const o = await getJobsOverview(db);

    expect(o.pipelines).toEqual([
      expect.objectContaining({
        fullName: "acme/api",
        role: "API",
        sync: expect.objectContaining({ state: "done", indexed: 72, embedded: 300, secretsDropped: [".env.example"] }),
        author: expect.objectContaining({ state: "running", planned: 4, proposed: 1, dropped: 1, skipped: 1, skipReasons: ["exists"], current: "Architecture", tokens: 1000, costUsd: 0.05 }),
        pendingReview: 1,
      }),
    ]);
    expect(o.runs.find((r) => r.id === run.id)?.repo).toBe("acme/api");
    // Progress ticks feed the card, not the activity feed.
    expect(o.activity.map((a) => a.action)).not.toContain("author.page_started");
    expect(o.activity.map((a) => a.action)).not.toContain("author.page_skipped");
    expect(jobsOverviewSchema.safeParse(JSON.parse(JSON.stringify(o))).success).toBe(true);
  });

  it("falls back to the finished run's skip total when no per-page skip events exist", async () => {
    const [repo] = await db.insert(repos).values({ owner: "acme", name: "old", syncedSha: "b".repeat(40) }).returning();
    const [run] = await db.insert(agentRuns).values({ kind: "author", model: "m", status: "succeeded" }).returning();
    const log = (action: string, details: Record<string, unknown>) => ({ actor: "agent" as const, action, repoId: repo.id, details });
    await db.insert(wikiLog).values([
      log("author.started", { runId: run.id }),
      log("author.outline", { runId: run.id, planned: 3 }),
      log("author.page_proposed", { runId: run.id, path: "Overview" }),
      log("author.finished", { runId: run.id, proposed: 1, skipped: 2 }),
    ]);

    const [p] = (await getJobsOverview(db)).pipelines;

    expect(p.author).toMatchObject({ state: "done", proposed: 1, skipped: 2, skipReasons: ["not recorded per page for this run"] });
  });
});
