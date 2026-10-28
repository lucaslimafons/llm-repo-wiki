import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { Citation, SearchHit } from "@/core/contracts";
import type { Db } from "@/db/client";
import { hydrateByKey } from "@/search";
import { evidenceText, groundDraft } from "./author";
import { MAX_ANSWER_CHUNKS } from "./explain-answer-limits";
import { modelName } from "./models";
import { startAgentRun } from "./runs";


export const explainAnswerInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  // Keys from /api/explain (`source:<uuid>` / `wiki:<uuid>`). The server re-reads the chunks: never trust client text.
  keys: z
    .array(z.string().regex(/^(source|wiki):[0-9a-f-]{36}$/i))
    .min(1)
    .max(MAX_ANSWER_CHUNKS),
});

export type ExplainAnswer = {
  answerMd: string;
  kept: Citation[];
  /** source: hrefs the model wrote that point at no chunk it was given; unwrapped to plain text. */
  stripped: string[];
  tokens: number;
  costUsd: number;
};

/**
 * One answer over exactly the chunks shown, then the author's grounding check on it, so the
 * explainer can show which citations survive. Chat itself does not strip citations.
 */
export async function explainAnswer(input: z.input<typeof explainAnswerInputSchema>, deps: { db: Db; model: LanguageModel }): Promise<ExplainAnswer> {
  const { query, keys } = explainAnswerInputSchema.parse(input);
  const refs = keys.map((k) => {
    const [kind, id] = k.split(":") as ["source" | "wiki", string];
    return { kind, id, score: 0 };
  });
  const byKey = await hydrateByKey(deps.db, refs);
  const hits = keys.flatMap((k) => byKey.get(k) ?? []) as SearchHit[];
  if (hits.length === 0) throw new Error("none of those chunks exist any more; run the search again");

  const run = await startAgentRun(deps.db, { kind: "chat", model: modelName(deps.model) });
  try {
    const out = await generateText({
      model: deps.model,
      instructions:
        "Answer the question in at most 200 words using ONLY the evidence. Cite every claim inline as [path#Lx-Ly](source:<source attribute>) with line ranges inside the excerpt. If the evidence does not answer it, say so.",
      prompt: `Question: ${query}\n\n${evidenceText(hits)}`,
      maxOutputTokens: 3_000,
      timeout: { totalMs: 60_000 },
      onStepEnd: (step) => run.addStep(step),
    });
    const grounded = groundDraft({ bodyMd: out.text, citations: [] }, hits);
    await run.finish({ status: "succeeded" });
    const t = run.totals();
    return {
      answerMd: grounded.bodyMd,
      kept: grounded.citations,
      stripped: grounded.stripped,
      tokens: t.inputTokens + t.outputTokens,
      costUsd: t.costUsd,
    };
  } catch (error) {
    await run.finish({ status: "failed", error });
    throw error;
  }
}
