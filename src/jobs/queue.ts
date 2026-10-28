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

/**
 * 🔴 pg-boss's default 900s limit expired a 20-minute author run and queued a retry while the
 * first run kept going (it cannot cancel the handler). A run here is bounded by its token budget.
 */
export const JOB_EXPIRY_SECONDS = { [QUEUES.syncRepo]: 60 * 60, [QUEUES.authorWiki]: 2 * 60 * 60 } as const;

export async function ensureQueues(b: PgBoss) {
  const retry = { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 600 };
  await b.createQueue(QUEUES.pollRepos, { policy: "singleton" });
  // stately + singletonKey(repoId): at most one queued and one active sync per repo,
  // so a burst of merges coalesces and the job always syncs the latest desired_sha.
  for (const [name, expireInSeconds] of Object.entries(JOB_EXPIRY_SECONDS)) {
    await b.createQueue(name, { policy: "stately", ...retry, expireInSeconds });
    // createQueue leaves an existing queue as it was, so databases from before this fix need the update.
    await b.updateQueue(name, { expireInSeconds });
  }
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
