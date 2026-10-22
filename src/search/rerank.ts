import { z } from "zod";
import type { SearchHit } from "@/core/contracts";

const rerankResponseSchema = z.object({
  results: z.array(z.object({ index: z.number().int().min(0), relevance_score: z.number() })),
  usage: z.object({ cost: z.number().optional() }).optional(),
});

/** Reorders hits with a cross-encoder via OpenRouter's /rerank. Measured in eval/run.ts before any default use. */
export async function rerankHits(
  hits: SearchHit[],
  query: string,
  opts: { apiKey: string; model: string; topN?: number; fetch?: typeof fetch },
): Promise<{ hits: SearchHit[]; costUsd: number }> {
  if (hits.length === 0) return { hits, costUsd: 0 };
  const documents = hits.map((h) => `${h.kind === "source" ? h.path : h.pagePath}\n${h.content}`.slice(0, 4_000));
  const res = await (opts.fetch ?? fetch)("https://openrouter.ai/api/v1/rerank", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: opts.model, query, documents, top_n: opts.topN ?? hits.length }),
  });
  if (!res.ok) throw new Error(`rerank ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = rerankResponseSchema.parse(await res.json());
  const reordered = parsed.results
    .filter((r) => r.index < hits.length)
    .map((r) => ({ ...hits[r.index], score: r.relevance_score }));
  return { hits: reordered, costUsd: parsed.usage?.cost ?? 0 };
}
