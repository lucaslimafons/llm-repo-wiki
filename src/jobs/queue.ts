import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { QUEUES, type JobPayloads } from "@/core/contracts";

type QueueName = keyof JobPayloads;

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

/** One started pg-boss per process (web enqueues, the worker also consumes). */
export function getBoss(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  starting ??= (async () => {
    const b = new PgBoss(env().DATABASE_URL);
    b.on("error", (err) => console.error("[pg-boss]", err));
    await b.start();
    await ensureQueues(b);
    boss = b;
    return b;
  })();
  return starting;
}

async function ensureQueues(b: PgBoss) {
  const retry = { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 600 };
  await b.createQueue(QUEUES.pollRepos, { policy: "singleton" });
  // stately + singletonKey(repoId): at most one queued and one active sync per repo,
  // so a burst of merges coalesces and the job always syncs the latest desired_sha.
  await b.createQueue(QUEUES.syncRepo, { policy: "stately", ...retry });
  await b.createQueue(QUEUES.authorWiki, { policy: "stately", ...retry });
  await b.createQueue(QUEUES.indexPage, { ...retry });
  await b.createQueue(QUEUES.lintWiki, { policy: "singleton" });
}

export async function enqueue<Q extends QueueName>(
  queue: Q,
  data: JobPayloads[Q],
  options: { singletonKey?: string; startAfter?: number } = {},
) {
  const b = await getBoss();
  return b.send(queue, data, options);
}

export async function enqueueRepoSync(repoId: string) {
  return enqueue(QUEUES.syncRepo, { repoId }, { singletonKey: repoId });
}
