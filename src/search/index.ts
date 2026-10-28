import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { SearchHit, SearchInput, SourceHit, WikiHit } from "@/core/contracts";
import { db as defaultDb, type Db } from "@/db/client";
import { chunks, repos, revisionSources, wikiChunks } from "@/db/schema";
import { repoFullNameSchema, type RepoRef } from "@/github/repo-name";
import { createOpenRouterEmbedder, toVector, type Embedder } from "@/ingest/embedder";
import { env, openRouterKey } from "@/lib/env";
import { pagePaths } from "./page-path";
import { providerPrivacy } from "@/lib/openrouter-privacy";

export const RRF_K = 60;
/** Candidates per retriever before fusion. */
export const CANDIDATES = 50;

export type SearchMode = "hybrid" | "vector" | "fts";
export type SearchDeps = { db: Db; embedder: Embedder };
/** RRF weight per list. 1:1 is plain RRF; the eval measures others (docs/eval). */
export type FusionWeights = { vector: number; fts: number };
const EQUAL_WEIGHTS: FusionWeights = { vector: 1, fts: 1 };

// Inputs can come straight from the model's tool call, so validate even typed callers.
const inputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  scope: z.enum(["source", "wiki", "all"]),
  repo: repoFullNameSchema.optional(),
  limit: z.number().int().min(1).max(CANDIDATES).default(10),
});

let defaults: SearchDeps | undefined;
export function defaultDeps(): SearchDeps {
  defaults ??= {
    db: defaultDb(),
    embedder: createOpenRouterEmbedder({ apiKey: openRouterKey(), model: env().EMBEDDING_MODEL, ...providerPrivacy() }),
  };
  return defaults;
}

/** Hybrid (vector + full-text, RRF k=60) search. */
export async function searchKnowledge(input: SearchInput, deps: SearchDeps = defaultDeps()): Promise<SearchHit[]> {
  return searchWithMode(input, "hybrid", deps);
}

/** `mode` exists for the eval (vector-only / full-text-only baselines). */
export async function searchWithMode(
  input: SearchInput,
  mode: SearchMode,
  deps: SearchDeps,
  weights: FusionWeights = EQUAL_WEIGHTS,
): Promise<SearchHit[]> {
  const parsed = inputSchema.parse(input);
  const { rows } = await rank(parsed, parsed.limit, mode, deps, weights);
  return hydrate(deps.db, rows);
}

/** One fused row, with where it sat in each list: what the /explain view draws. */
export type RankedRow = {
  kind: "source" | "wiki";
  id: string;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
  /** Cosine distance (0 = same direction). */
  vecDistance: number | null;
  /** ts_rank_cd, higher is better. */
  ftsScore: number | null;
};

/**
 * Runs the hybrid query and keeps each list's rank and raw score. `limit` may exceed the tool's
 * cap: the explainer asks for every candidate so it can show both lists in full.
 */
export async function rank(
  input: { query: string; scope: SearchInput["scope"]; repo?: RepoRef },
  limit: number,
  mode: SearchMode,
  deps: SearchDeps,
  weights: FusionWeights = EQUAL_WEIGHTS,
): Promise<{ rows: RankedRow[]; vector: number[] | null }> {
  const { query, scope, repo } = input;
  const { db, embedder } = deps;

  let repoId: string | null = null;
  if (repo) {
    const [row] = await db
      .select({ id: repos.id })
      .from(repos)
      .where(and(sql`lower(${repos.owner}) = lower(${repo.owner})`, sql`lower(${repos.name}) = lower(${repo.name})`));
    if (!row) return { rows: [], vector: null };
    repoId = row.id;
  }

  const vector = mode === "fts" ? null : (await embedder.embed([query]))[0];
  const ranked = await db.transaction(async (tx) => {
    // Without the iterative scan, a selective filter can leave HNSW with too few rows.
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    return tx.execute<{
      kind: "source" | "wiki";
      id: string;
      score: number;
      vec_rank: number | null;
      fts_rank: number | null;
      vec_d: number | null;
      fts_d: number | null;
    }>(fusedQuery({ query, vector, model: embedder.model, scope, repoId, limit, mode, weights }));
  });
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows = ranked.map((r) => {
    const ftsD = num(r.fts_d);
    return {
      kind: r.kind,
      id: r.id,
      score: Number(r.score),
      vecRank: num(r.vec_rank),
      ftsRank: num(r.fts_rank),
      vecDistance: num(r.vec_d),
      ftsScore: ftsD === null ? null : -ftsD,
    };
  });
  return { rows, vector };
}

type QueryParts = {
  query: string;
  vector: number[] | null;
  model: string;
  scope: SearchInput["scope"];
  repoId: string | null;
  limit: number;
  mode: SearchMode;
  weights: FusionWeights;
};

function fusedQuery(p: QueryParts): SQL {
  const wantSource = p.scope !== "wiki";
  const wantWiki = p.scope !== "source";
  const srcRepo = p.repoId ? sql`and c.repo_id = ${p.repoId}::uuid` : sql``;
  // The wiki is shared across repos: a repo filter keeps pages whose revision cites that repo.
  const wikiRepo = p.repoId
    ? sql`and exists (select 1 from ${revisionSources} rs where rs.revision_id = w.revision_id and rs.repo_id = ${p.repoId}::uuid)`
    : sql``;
  const none = sql`select null::text as kind, null::uuid as id, null::float8 as d where false`;

  const vecParts: SQL[] = [];
  const ftsParts: SQL[] = [];
  if (p.vector) {
    const v = sql`${toVector(p.vector)}::vector`;
    if (wantSource)
      vecParts.push(sql`(select 'source'::text as kind, c.id, c.embedding <=> ${v} as d from ${chunks} c
        where c.embedding_model = ${p.model} ${srcRepo} order by c.embedding <=> ${v} limit ${CANDIDATES})`);
    if (wantWiki)
      vecParts.push(sql`(select 'wiki'::text as kind, w.id, w.embedding <=> ${v} as d from ${wikiChunks} w
        where w.embedding_model = ${p.model} ${wikiRepo} order by w.embedding <=> ${v} limit ${CANDIDATES})`);
  }
  if (p.mode !== "vector") {
    const tq = tsQuery(p.query);
    if (wantSource)
      ftsParts.push(sql`(select 'source'::text as kind, c.id, -ts_rank_cd(c.tsv, ${tq}) as d from ${chunks} c
        where c.tsv @@ ${tq} ${srcRepo} order by d limit ${CANDIDATES})`);
    if (wantWiki)
      ftsParts.push(sql`(select 'wiki'::text as kind, w.id, -ts_rank_cd(w.tsv, ${tq}) as d from ${wikiChunks} w
        where w.tsv @@ ${tq} ${wikiRepo} order by d limit ${CANDIDATES})`);
  }
  const union = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` union all `) : none);

  // Each list is ranked by its own score; fusion only ever sees ranks, so the scales never mix.
  return sql`
    with vec as (
      select kind, id, d, row_number() over (order by d) as r
      from (${union(vecParts)}) u order by d limit ${CANDIDATES}
    ),
    fts as (
      select kind, id, d, row_number() over (order by d) as r
      from (${union(ftsParts)}) u order by d limit ${CANDIDATES}
    )
    select coalesce(vec.kind, fts.kind) as kind,
           coalesce(vec.id, fts.id) as id,
           coalesce(${p.weights.vector}::float8 / (${RRF_K} + vec.r), 0) + coalesce(${p.weights.fts}::float8 / (${RRF_K} + fts.r), 0) as score,
           vec.r as vec_rank, fts.r as fts_rank, vec.d as vec_d, fts.d as fts_d
    from vec full outer join fts on vec.kind = fts.kind and vec.id = fts.id
    order by score desc, coalesce(vec.r, ${CANDIDATES + 1}), coalesce(fts.r, ${CANDIDATES + 1})
    limit ${p.limit}`;
}

// English glue words: 'simple' keeps identifiers unstemmed, but has no stopword list of its own.
const STOPWORDS = new Set(
  "a an and are as at be but by can could do does for from get has have how i if in into is it its me my of on or our should so than that the their them then there these this those to use using via was we what when where which who why will with would you your".split(
    " ",
  ),
);

/**
 * websearch syntax (quotes, -exclusions) with OR between the remaining terms. 🔴 AND semantics
 * matched nothing for natural-language questions (recall@5 0.00 on eval/golden.json; OR without
 * stopwords 0.55), and ts_rank_cd still ranks chunks matching more terms first.
 */
export function tsQuery(query: string): SQL {
  const kept = query
    .split(/\s+/)
    .filter((w) => w.includes('"') || !STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")))
    .join(" ");
  const q = kept.trim() || query;
  return sql`regexp_replace(websearch_to_tsquery('simple', ${q})::text, ' & (?!!)', ' | ', 'g')::tsquery`;
}

type RankedRef = { kind: "source" | "wiki"; id: string; score: number };

async function hydrate(db: Db, ranked: RankedRef[]): Promise<SearchHit[]> {
  const byKey = await hydrateByKey(db, ranked);
  return ranked.flatMap((r) => byKey.get(`${r.kind}:${r.id}`) ?? []);
}

/** Hits keyed `kind:id`: wiki hits carry their page, not the chunk, so callers that link lists need this. */
export async function hydrateByKey(db: Db, ranked: RankedRef[]): Promise<Map<string, SearchHit>> {
  const srcIds = ranked.filter((r) => r.kind === "source").map((r) => r.id);
  const wikiIds = ranked.filter((r) => r.kind === "wiki").map((r) => r.id);

  const [srcRows, wikiRows] = await Promise.all([
    srcIds.length
      ? db
          .select({
            id: chunks.id,
            owner: repos.owner,
            name: repos.name,
            path: chunks.path,
            startLine: chunks.startLine,
            endLine: chunks.endLine,
            commitSha: chunks.commitSha,
            symbol: chunks.symbol,
            content: chunks.content,
          })
          .from(chunks)
          .innerJoin(repos, eq(repos.id, chunks.repoId))
          .where(inArray(chunks.id, srcIds))
      : [],
    wikiIds.length
      ? db
          .select({ id: wikiChunks.id, pageId: wikiChunks.pageId, headingPath: wikiChunks.headingPath, content: wikiChunks.content })
          .from(wikiChunks)
          .where(inArray(wikiChunks.id, wikiIds))
      : [],
  ]);
  const paths = await pagePaths(db, [...new Set(wikiRows.map((w) => w.pageId))]);
  const src = new Map(srcRows.map((r) => [r.id, r]));
  const wiki = new Map(wikiRows.map((r) => [r.id, r]));

  const hits = new Map<string, SearchHit>();
  for (const r of ranked) {
    if (r.kind === "source") {
      const c = src.get(r.id);
      if (!c) continue;
      const hit: SourceHit = {
        kind: "source",
        chunkId: c.id,
        repo: `${c.owner}/${c.name}`,
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
        commitSha: c.commitSha,
        symbol: c.symbol,
        content: c.content,
        score: r.score,
      };
      hits.set(`source:${r.id}`, hit);
    } else {
      const w = wiki.get(r.id);
      if (!w) continue;
      const hit: WikiHit = {
        kind: "wiki",
        pageId: w.pageId,
        pagePath: paths.get(w.pageId) ?? "",
        headingPath: w.headingPath,
        content: w.content,
        score: r.score,
      };
      hits.set(`wiki:${r.id}`, hit);
    }
  }
  return hits;
}
