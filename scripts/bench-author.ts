import { and, eq, sql } from "drizzle-orm";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { runAuthorJob } from "@/agent/author";
import { db } from "@/db/client";
import { repos } from "@/db/schema";
import { parseRepoFullName } from "@/github/repo-name";
import { getBoss } from "@/jobs/queue";
import { openRouterKey } from "@/lib/env";
import { providerPrivacy } from "@/lib/openrouter-privacy";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";

/**
 * `pnpm bench:author <model> <owner/name> --wipe`: writes a whole wiki for one synced repo with one
 * author model and prints pages, grounding, tokens, cost and time. 🔴 Deletes every wiki page first.
 */
const [model, repoName] = process.argv.slice(2);
if (!model || !repoName || !process.argv.includes("--wipe")) {
  console.error("usage: pnpm bench:author <openrouter model> <owner/name> --wipe   (deletes every wiki page first)");
  process.exit(1);
}
const ref = parseRepoFullName(repoName);
const [repo] = await db().select().from(repos).where(and(eq(repos.owner, ref.owner), eq(repos.name, ref.name)));
if (!repo?.syncedSha) throw new Error(`${repoName} is not added and synced yet`);

await db().execute(sql`delete from pages`);
const t0 = Date.now();
try {
  const result = await runAuthorJob(
    { db: db(), store: wikiStore, search: searchKnowledge, model: createOpenRouter({ apiKey: openRouterKey() })(model, { usage: { include: true }, ...providerPrivacy() }) },
    { repoId: repo.id, fromSha: null, toSha: repo.syncedSha, changedPaths: [] },
  );
  const [stats] = await db().execute<{ cost: string; input: number; output: number; cited: number; ungrounded: number }>(sql`
    with r as (select id, cost_usd, input_tokens, output_tokens from agent_runs where kind = 'author' order by started_at desc limit 1)
    select r.cost_usd as cost, r.input_tokens as input, r.output_tokens as output,
      coalesce(sum((l.details->>'citations')::int), 0)::int as cited, coalesce(sum((l.details->>'ungrounded')::int), 0)::int as ungrounded
    from r left join wiki_log l on l.details->>'runId' = r.id::text and l.action = 'author.page_proposed'
    group by r.cost_usd, r.input_tokens, r.output_tokens`);
  console.log(
    `${model}: status=${result.status} proposed=${result.proposed.length} dropped=${result.dropped.length} citations=${stats.cited} ungrounded=${stats.ungrounded} tokens=${stats.input}/${stats.output} cost=$${stats.cost} time=${Math.round((Date.now() - t0) / 1000)}s`,
  );
  for (const d of result.dropped) console.log(`  dropped ${d.path}: ${d.reason}`);
} catch (err) {
  console.log(`${model}: FAILED ${(err as Error).message} after ${Math.round((Date.now() - t0) / 1000)}s`);
}
await (await getBoss()).stop({ graceful: false });
await db().$client.end();
process.exit(0);
