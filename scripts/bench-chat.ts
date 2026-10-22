import { readFile } from "node:fs/promises";
import { isStepCount, ToolLoopAgent } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { CHAT_MAX_STEPS } from "@/agent/chat";
import { buildChatInstructions, loadWikiSchema } from "@/agent/prompts";
import { WIKI_TOOL_APPROVAL } from "@/agent/tool-names";
import { createWikiTools } from "@/agent/tools";
import { db } from "@/db/client";
import { getBoss } from "@/jobs/queue";
import { openRouterKey } from "@/lib/env";
import { parseSourceHref } from "@/lib/source-links";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";

/**
 * `pnpm bench:chat <model> [more models…]`: the real chat agent (tools, prompt, step cap) on the
 * first questions of eval/golden.json. "Grounded" = the answer cites a file the question expects.
 */
const QUESTIONS = Number(process.env.BENCH_QUESTIONS ?? 6);
const golden = z
  .object({ questions: z.array(z.object({ q: z.string(), expected: z.array(z.string()) })) })
  .parse(JSON.parse(await readFile(new URL("../eval/golden.json", import.meta.url), "utf8")));
const models = process.argv.slice(2);
if (models.length === 0) throw new Error("usage: pnpm bench:chat <openrouter model> [...]");

const openrouter = createOpenRouter({ apiKey: openRouterKey() });
const instructions = buildChatInstructions({ schema: await loadWikiSchema(), tree: await wikiStore.listTree(), summary: null });
const tools = createWikiTools({ store: wikiStore, search: searchKnowledge, author: { kind: "human" }, mode: "apply" });

for (const model of models) {
  const agent = new ToolLoopAgent({
    model: openrouter(model, { usage: { include: true } }),
    instructions,
    tools,
    stopWhen: isStepCount(CHAT_MAX_STEPS),
    toolApproval: WIKI_TOOL_APPROVAL,
  });
  let grounded = 0, cited = 0, searches = 0, cost = 0, ms = 0, failures = 0;
  const notes: string[] = [];
  for (const { q, expected } of golden.questions.slice(0, QUESTIONS)) {
    const t0 = performance.now();
    try {
      const out = await agent.generate({ prompt: q });
      ms += performance.now() - t0;
      for (const s of out.steps) {
        cost += (s.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined)?.usage?.cost ?? 0;
        searches += s.toolCalls.filter((c) => c.toolName === "searchKnowledge").length;
      }
      const citations = [...out.text.matchAll(/\]\((source:[^)\s]+)\)/g)].map((m) => parseSourceHref(m[1])).filter((c) => c !== null);
      cited += citations.length;
      if (citations.some((c) => expected.includes(c.path))) grounded++;
      else notes.push(`ungrounded: ${q}`);
    } catch (err) {
      ms += performance.now() - t0;
      failures++;
      notes.push(`failed: ${q}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  const n = Math.min(QUESTIONS, golden.questions.length);
  console.log(
    `CHAT ${JSON.stringify({ model, questions: n, grounded, failures, citationsPerAnswer: +(cited / n).toFixed(1), searchesPerAnswer: +(searches / n).toFixed(1), secondsPerAnswer: +(ms / n / 1000).toFixed(1), costPerAnswer: +(cost / n).toFixed(5), totalCost: +cost.toFixed(4) })}`,
  );
  for (const note of notes) console.log(`  ${note}`);
}
await (await getBoss()).stop({ graceful: false });
await db().$client.end();
process.exit(0);
