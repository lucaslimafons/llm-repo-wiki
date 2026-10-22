import { db } from "@/db/client";
import { handleGitHubWebhook } from "@/ingest/webhook";
import { enqueueRepoSync } from "@/jobs/queue";
import { env } from "@/lib/env";

// No segment config: cacheComponents rejects `runtime`/`dynamic`, Node is already the default
// runtime (node:crypto works), and a POST handler always runs at request time.
export async function POST(req: Request): Promise<Response> {
  // The signature covers the exact bytes, so read the raw body before anything parses it.
  const raw = await req.text();
  const res = await handleGitHubWebhook(
    { db: db(), secret: env().GITHUB_WEBHOOK_SECRET, enqueueSync: enqueueRepoSync },
    raw,
    req.headers,
  );
  return new Response(res.body, { status: res.status });
}
