import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { repos, webhookDeliveries } from "@/db/schema";
import { queuedUnlessSyncing } from "./repos";

/** GitHub's `X-Hub-Signature-256`: `sha256=<hex HMAC of the raw body>`. */
export function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const given = Buffer.from(header);
  // timingSafeEqual throws on unequal lengths, so check first (length is not secret).
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const pushSchema = z.object({
  ref: z.string(),
  after: z.string().regex(/^[0-9a-f]{40}$/),
  deleted: z.boolean().optional(),
  repository: z.object({ name: z.string(), owner: z.object({ login: z.string().optional(), name: z.string().optional() }) }),
});

export type WebhookDeps = {
  db: Db;
  secret: string | undefined;
  enqueueSync: (repoId: string) => Promise<unknown>;
};

export type WebhookResponse = { status: number; body: string };

/** Only a `push` to an added repo's default branch moves `desired_sha`; everything else is acked. */
export async function handleGitHubWebhook(deps: WebhookDeps, rawBody: string, headers: Headers): Promise<WebhookResponse> {
  if (!deps.secret) return { status: 404, body: "not found" };
  if (!verifySignature(deps.secret, rawBody, headers.get("x-hub-signature-256"))) {
    return { status: 401, body: "bad signature" };
  }
  const event = headers.get("x-github-event") ?? "";
  const delivery = headers.get("x-github-delivery");
  if (!delivery) return { status: 400, body: "missing delivery id" };

  const inserted = await deps.db
    .insert(webhookDeliveries)
    .values({ deliveryId: delivery.slice(0, 200), event: event.slice(0, 100) })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.deliveryId });
  if (!inserted.length) return { status: 200, body: "duplicate" };

  // A delivery we failed to act on must stay redeliverable, so forget it before reporting the error.
  try {
    return await processDelivery(deps, event, rawBody);
  } catch (err) {
    await deps.db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, delivery.slice(0, 200)));
    throw err;
  }
}

async function processDelivery(deps: WebhookDeps, event: string, rawBody: string): Promise<WebhookResponse> {
  if (event !== "push") return { status: 202, body: "ignored" };

  let payload: z.infer<typeof pushSchema>;
  try {
    payload = pushSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: "invalid push payload" };
  }
  if (payload.deleted) return { status: 202, body: "ignored" };
  const owner = payload.repository.owner.login ?? payload.repository.owner.name ?? "";

  const [repo] = await deps.db
    .select()
    .from(repos)
    .where(and(sql`lower(${repos.owner}) = lower(${owner})`, sql`lower(${repos.name}) = lower(${payload.repository.name})`));
  if (!repo || !repo.defaultBranch || payload.ref !== `refs/heads/${repo.defaultBranch}`) {
    return { status: 202, body: "ignored" };
  }

  await deps.db
    .update(repos)
    .set({ desiredSha: payload.after, status: queuedUnlessSyncing })
    .where(eq(repos.id, repo.id));
  await deps.enqueueSync(repo.id);
  return { status: 202, body: "queued" };
}
