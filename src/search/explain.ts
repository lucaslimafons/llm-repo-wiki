import { sql } from "drizzle-orm";
import { z } from "zod";
import type { SearchHit } from "@/core/contracts";
import { env, openRouterKey } from "@/lib/env";
import { providerPrivacy } from "@/lib/openrouter-privacy";
import { CANDIDATES, RERANK_POOL, RRF_K } from "./constants";
import { defaultDeps, hydrateByKey, rank, tsQuery, type RankedRow, type SearchDeps } from "./index";
import { rerankHits } from "./rerank";

/** Rows shown per list. The fusion still runs over every candidate, exactly like chat search. */
const EXPLAIN_LIST_SIZE = 10;
const PREVIEW_CHARS = 600;

export const explainInputSchema = z.object({
  query: z.string().trim().min(1, "Type a question.").max(500, "Keep the question under 500 characters."),
  rerank: z.boolean().default(false),
});
export type ExplainInput = z.input<typeof explainInputSchema>;

export type ExplainItem = {
  /** `kind:id`, stable across the three lists so the view can link them. */
  key: string;
  hit: SearchHit;
  ftsRank: number | null;
  vecRank: number | null;
  ftsScore: number | null;
  /** 1 - cosine distance. */
  vecSimilarity: number | null;
  fusedRank: number;
  fusedScore: number;
};

export type SearchExplanation = {
  query: string;
  /** The tsquery Postgres actually ran (stopwords removed, terms OR'ed). */
  tsquery: string;
  embedding: { model: string; dims: number; preview: number[] } | null;
  rrfK: number;
  candidates: { fts: number; vector: number; fused: number };
  fts: ExplainItem[];
  vector: ExplainItem[];
  fused: ExplainItem[];
  reranked: { model: string; costUsd: number; items: (ExplainItem & { rerankScore: number })[] } | null;
  /** False while OPENROUTER_ZDR is on: no rerank model on OpenRouter has a zero-retention endpoint. */
  rerankAvailable: boolean;
};

const RERANK_NEEDS_RETENTION =
  "Rerank is off because OPENROUTER_ZDR is on: every rerank model on OpenRouter runs on a provider endpoint without zero data retention.";

const keyOf = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

/** Hybrid search with its working shown: both lists, their ranks, and the fused order. */
export async function explainSearch(input: ExplainInput, deps: SearchDeps = defaultDeps()): Promise<SearchExplanation> {
  const { query, rerank: withRerank } = explainInputSchema.parse(input);
  const rerankAvailable = !env().OPENROUTER_ZDR;
  if (withRerank && !rerankAvailable) throw new Error(RERANK_NEEDS_RETENTION);
  const { rows, vector } = await rank({ query, scope: "all" }, CANDIDATES * 2, "hybrid", deps);

  const fts = rows.filter((r) => r.ftsRank !== null).sort((a, b) => a.ftsRank! - b.ftsRank!).slice(0, EXPLAIN_LIST_SIZE);
  const vec = rows.filter((r) => r.vecRank !== null).sort((a, b) => a.vecRank! - b.vecRank!).slice(0, EXPLAIN_LIST_SIZE);
  const pool = rows.slice(0, Math.max(EXPLAIN_LIST_SIZE, withRerank ? RERANK_POOL : 0));

  const wanted = new Map<string, RankedRow>();
  for (const r of [...fts, ...vec, ...pool]) wanted.set(keyOf(r), r);
  const byKey = await hydrateByKey(deps.db, [...wanted.values()]);
  const fusedRank = new Map(rows.map((r, i) => [keyOf(r), i + 1]));

  const item = (r: RankedRow): ExplainItem | null => {
    const hit = byKey.get(keyOf(r));
    if (!hit) return null;
    return {
      key: keyOf(r),
      hit: { ...hit, content: hit.content.slice(0, PREVIEW_CHARS) },
      ftsRank: r.ftsRank,
      vecRank: r.vecRank,
      ftsScore: r.ftsScore,
      vecSimilarity: r.vecDistance === null ? null : 1 - r.vecDistance,
      fusedRank: fusedRank.get(keyOf(r))!,
      fusedScore: r.score,
    };
  };
  const items = (list: RankedRow[]) => list.map(item).filter((x): x is ExplainItem => x !== null);

  const [{ tq }] = await deps.db.execute<{ tq: string }>(sql`select ${tsQuery(query)}::text as tq`);

  let reranked: SearchExplanation["reranked"] = null;
  if (withRerank) {
    const poolItems = new Map(items(pool).map((i) => [i.key, i]));
    const model = env().RERANK_MODEL;
    // Full content, as the eval measured; the key rides along because rerankHits spreads each hit.
    const tagged = [...poolItems.keys()].map((key) => ({ ...byKey.get(key)!, explainKey: key }));
    const out = await rerankHits(tagged, query, { apiKey: openRouterKey(), model, provider: providerPrivacy().provider });
    reranked = {
      model,
      costUsd: out.costUsd,
      items: out.hits.slice(0, EXPLAIN_LIST_SIZE).flatMap((h) => {
        const original = poolItems.get((h as (typeof tagged)[number]).explainKey);
        return original ? [{ ...original, rerankScore: h.score }] : [];
      }),
    };
  }

  return {
    query,
    tsquery: tq,
    embedding: vector ? { model: deps.embedder.model, dims: vector.length, preview: vector.slice(0, 6).map((n) => Number(n.toFixed(4))) } : null,
    rrfK: RRF_K,
    candidates: {
      fts: rows.filter((r) => r.ftsRank !== null).length,
      vector: rows.filter((r) => r.vecRank !== null).length,
      fused: rows.length,
    },
    fts: items(fts),
    vector: items(vec),
    fused: items(rows.slice(0, EXPLAIN_LIST_SIZE)),
    reranked,
    rerankAvailable,
  };
}
