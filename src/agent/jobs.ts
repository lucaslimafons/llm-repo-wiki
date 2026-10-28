import type { PgBoss } from "pg-boss";
import { QUEUES } from "@/core/contracts";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";
import { runAuthorJob, type AuthorPayload } from "./author";
import { authorModel } from "./models";

/** Track-owned: register this track's pg-boss workers and schedules. */
export async function registerAgentJobs(boss: PgBoss): Promise<void> {
  await boss.work<AuthorPayload>(QUEUES.authorWiki, async (jobs) => {
    for (const job of jobs) {
      const result = await runAuthorJob(
        { db: db(), store: wikiStore, search: searchKnowledge, model: authorModel(), tokenBudget: env().AUTHOR_TOKEN_BUDGET },
        job.data,
      );
      console.log(`[author-wiki] ${job.data.repoId}: ${result.mode}, ${result.proposed.length} proposed, ${result.dropped.length} dropped`);
    }
  });
}
