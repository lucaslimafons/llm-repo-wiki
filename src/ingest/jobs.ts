import type { PgBoss } from "pg-boss";
import { QUEUES, type JobPayloads } from "@/core/contracts";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { repos } from "@/db/schema";
import { enqueue, enqueueRepoSync } from "@/jobs/queue";
import { env } from "@/lib/env";
import { wikiStore } from "@/wiki/store";
import { createDefaultChunker } from "./chunk";
import { prodEmbedder, prodGitHub } from "./deps";
import { indexPage } from "./index-page";
import { pollRepos } from "./poll";
import { syncRepo, type SyncDeps } from "./sync";

function prodSyncDeps(): SyncDeps {
  return {
    db: db(),
    github: prodGitHub(),
    embedder: prodEmbedder(),
    chunker: createDefaultChunker(),
    markStaleByFiles: async (repoId, paths) => {
      const [repo] = await db().select({ wikiId: repos.wikiId }).from(repos).where(eq(repos.id, repoId));
      return repo ? wikiStore(repo.wikiId).markStaleByFiles(repoId, paths) : [];
    },
    // stately + singletonKey: a second author run for the same repo coalesces into the queued one.
    enqueueAuthor: (payload) => enqueue(QUEUES.authorWiki, payload, { singletonKey: payload.repoId }),
    enqueueSync: enqueueRepoSync,
  };
}

/** Registers sync-repo, poll-repos (scheduled) and index-page. Handlers throw to make pg-boss retry. */
export async function registerIngestJobs(boss: PgBoss): Promise<void> {
  await boss.work<JobPayloads[typeof QUEUES.syncRepo]>(QUEUES.syncRepo, async ([job]) => {
    const result = await syncRepo(prodSyncDeps(), job.data.repoId);
    console.log(`[sync-repo] ${job.data.repoId}:`, JSON.stringify(result.status === "synced" ? { ...result, changedPaths: result.changedPaths.length } : result));
    return result.status;
  });

  await boss.work(QUEUES.pollRepos, async () => {
    return pollRepos({ db: db(), github: prodGitHub(), enqueueSync: enqueueRepoSync });
  });
  const every = env().POLL_INTERVAL_MINUTES;
  await boss.schedule(QUEUES.pollRepos, every < 60 ? `*/${every} * * * *` : "0 * * * *");

  await boss.work<JobPayloads[typeof QUEUES.indexPage]>(QUEUES.indexPage, async ([job]) => {
    return indexPage({ db: db(), embedder: prodEmbedder() }, job.data);
  });
}
