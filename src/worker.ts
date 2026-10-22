import { env } from "@/lib/env";
import { getBoss } from "@/jobs/queue";
import { registerIngestJobs } from "@/ingest/jobs";
import { registerWikiJobs } from "@/wiki/jobs";
import { registerAgentJobs } from "@/agent/jobs";

/** Long-running job consumer. Runs beside `next dev`, never inside it. */
async function main() {
  env();
  const boss = await getBoss();
  await registerIngestJobs(boss);
  await registerWikiJobs(boss);
  await registerAgentJobs(boss);
  console.log("[worker] ready");

  const stop = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
