/**
 * Retrieval eval: recall@5, MRR@10, latency and cost per retrieval strategy (vector, full-text,
 * RRF hybrid, weighted RRF, each with a cross-encoder reranker, and the vectorless wiki-tree walk)
 * over a pinned commit of a public repo. Syncs that commit first (real embeddings, so it needs
 * OPENROUTER_API_KEY). Run: pnpm eval [name filter]
 */
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { repos } from "@/db/schema";
import { createWiki, getWikiBySlug } from "@/wikis/wikis";
import { createGitHubClient } from "@/github/client";
import { parseRepoFullName } from "@/github/repo-name";
import { createDefaultChunker } from "@/ingest/chunk";
import { createOpenRouterEmbedder } from "@/ingest/embedder";
import { syncRepo } from "@/ingest/sync";
import { env, openRouterKey } from "@/lib/env";
import type { SearchHit } from "@/core/contracts";
import { searchWithMode, type FusionWeights, type SearchMode } from "@/search";
import { RERANK_POOL } from "@/search/constants";
import { rerankHits } from "@/search/rerank";
import { providerPrivacy } from "@/lib/openrouter-privacy";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { loadTreePages, treeSearch } from "@/search/tree";

const goldenSchema = z.object({
  repo: z.string(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  questions: z.array(z.object({ q: z.string(), expected: z.array(z.string()).min(1) })).min(1),
});

const K_RECALL = 5;
const K_MRR = 10;
/** The tree walk's model; the wiki it walks is the one holding the golden repo. */
const TREE_MODEL = process.env.EVAL_TREE_MODEL || "anthropic/claude-haiku-5.5";

type SearchStrategy = { name: string; mode: SearchMode; weights?: FusionWeights; rerank?: string };
/** Any retriever: a question in, ranked file paths (one per hit, repeats allowed) and dollars out. */
type Retriever = { name: string; run(q: string): Promise<{ paths: string[]; costUsd: number }> };

const SEARCH_STRATEGIES: SearchStrategy[] = [
  { name: "vector", mode: "vector" },
  { name: "fts", mode: "fts" },
  { name: "hybrid 1:1", mode: "hybrid" },
  { name: "hybrid 2:1", mode: "hybrid", weights: { vector: 2, fts: 1 } },
  { name: "hybrid 3:1", mode: "hybrid", weights: { vector: 3, fts: 1 } },
  { name: "vector + rerank-4-fast", mode: "vector", rerank: "cohere/rerank-4-fast" },
  { name: "hybrid + rerank-4-fast", mode: "hybrid", rerank: "cohere/rerank-4-fast" },
  { name: "hybrid + rerank-4-pro", mode: "hybrid", rerank: "cohere/rerank-4-pro" },
];

async function main() {
  const golden = goldenSchema.parse(JSON.parse(await readFile(new URL("./golden.json", import.meta.url), "utf8")));
  const ref = parseRepoFullName(golden.repo);
  const database = db();
  const github = createGitHubClient({ token: env().GITHUB_TOKEN });
  const embedder = createOpenRouterEmbedder({ apiKey: openRouterKey(), model: env().EMBEDDING_MODEL, ...providerPrivacy() });

  // Pin the repo to the golden commit so the expected paths are guaranteed to exist.
  // A repo lives in one wiki: reuse the golden repo wherever it is, else put it in an "eval" wiki.
  let [repo] = await database.select().from(repos).where(and(eq(repos.owner, ref.owner), eq(repos.name, ref.name)));
  if (!repo) {
    const existing = await getWikiBySlug(database, "eval");
    const created = existing ? null : await createWiki(database, { name: "eval" });
    if (created && !created.ok) throw new Error(created.error);
    const wikiId = existing?.id ?? (created as { ok: true; data: { id: string } }).data.id;
    repo = (await database.insert(repos).values({ ...ref, wikiId, desiredSha: golden.sha }).returning())[0];
  }
  if (repo.syncedSha !== golden.sha) {
    console.log(`syncing ${golden.repo}@${golden.sha.slice(0, 7)}…`);
    await database.update(repos).set({ desiredSha: golden.sha }).where(eq(repos.id, repo.id));
    await syncRepo(
      {
        db: database,
        github,
        embedder,
        chunker: createDefaultChunker(),
        markStaleByFiles: async () => [],
        enqueueAuthor: async () => {},
        enqueueSync: async () => {},
      },
      repo.id,
    );
  }

  const searchRetriever = (st: SearchStrategy): Retriever => ({
    name: st.name,
    async run(q) {
      let hits: SearchHit[] = await searchWithMode(
        { wikiId: repo.wikiId, query: q, scope: "source", repo: golden.repo, limit: st.rerank ? RERANK_POOL : K_MRR },
        st.mode,
        { db: database, embedder },
        st.weights,
      );
      let costUsd = 0;
      if (st.rerank) {
        const out = await rerankHits(hits, q, { apiKey: openRouterKey(), model: st.rerank, topN: K_MRR, ...providerPrivacy() });
        hits = out.hits;
        costUsd = out.costUsd;
      }
      return { paths: hits.flatMap((h) => (h.kind === "source" ? [h.path] : [])), costUsd };
    },
  });
  let treePages: Awaited<ReturnType<typeof loadTreePages>> | undefined;
  const treeModel = createOpenRouter({ apiKey: openRouterKey() }).chat(TREE_MODEL, { usage: { include: true }, ...providerPrivacy() });
  const treeRetriever: Retriever = {
    name: `wiki tree (${TREE_MODEL.split("/").pop()})`,
    async run(q) {
      treePages ??= await loadTreePages(database, repo.wikiId);
      if (!treePages.length) throw new Error(`the wiki holding ${golden.repo} has no pages: write it first`);
      const out = await treeSearch(q, treePages, { model: treeModel, repo: golden.repo, limit: K_MRR });
      return { paths: out.citations.map((c) => c.path), costUsd: out.costUsd };
    },
  };
  const retrievers: Retriever[] = [...SEARCH_STRATEGIES.map(searchRetriever), treeRetriever];

  const only = process.argv[2];
  const rows: { name: string; recall: number; mrr: number; ms: number; cost: number; misses: string[] }[] = [];
  for (const r of retrievers.filter((x) => !only || x.name.includes(only))) {
    let found = 0;
    let rr = 0;
    let ms = 0;
    let cost = 0;
    const misses: string[] = [];
    for (const { q, expected } of golden.questions) {
      const t0 = performance.now();
      const out = await r.run(q);
      ms += performance.now() - t0;
      cost += out.costUsd;
      const rank = out.paths.slice(0, K_MRR).findIndex((p) => expected.includes(p));
      if (rank >= 0 && rank < K_RECALL) found++;
      else misses.push(q);
      if (rank >= 0) rr += 1 / (rank + 1);
    }
    const n = golden.questions.length;
    rows.push({ name: r.name, recall: found / n, mrr: rr / n, ms: ms / n, cost, misses });
  }

  console.log(`\n${golden.repo}@${golden.sha.slice(0, 7)} · ${golden.questions.length} questions · ${embedder.model}\n`);
  console.log(`${"strategy".padEnd(28)} recall@${K_RECALL}  MRR@${K_MRR}  ms/query  model $`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(28)} ${r.recall.toFixed(3).padStart(8)}  ${r.mrr.toFixed(3).padStart(6)}  ${r.ms.toFixed(0).padStart(8)}  ${r.cost.toFixed(4).padStart(8)}`);
  }
  if (process.env.EVAL_JSON) console.log(`JSON ${JSON.stringify(rows)}`);
  await database.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
