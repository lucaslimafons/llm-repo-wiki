import type { PgBoss } from "pg-boss";
import { QUEUES } from "@/core/contracts";
import { db } from "@/db/client";
import { runLint } from "./lint";

/** Daily at 06:00 (pg-boss cron, UTC). The lint is deterministic and cheap; no model is called. */
export const LINT_CRON = "0 6 * * *";

export async function registerWikiJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.lintWiki, async () => {
    const findings = await runLint(db());
    console.log(`[lint-wiki] ${findings.length} findings`);
  });
  await boss.schedule(QUEUES.lintWiki, LINT_CRON);
}
