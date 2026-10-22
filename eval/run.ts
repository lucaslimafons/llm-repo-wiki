/**
 * Retrieval eval: recall@5 and MRR@10 for vector-only, full-text-only and hybrid over a pinned
 * commit of a public repo. Syncs that commit first (real embeddings, so it needs
 * OPENROUTER_API_KEY). Run: pnpm tsx --env-file=.env.local eval/run.ts
 */
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { repos } from "@/db/schema";
import { createGitHubClient } from "@/github/client";
import { parseRepoFullName } from "@/github/repo-name";
import { createDefaultChunker } from "@/ingest/chunk";
import { createOpenRouterEmbedder } from "@/ingest/embedder";
import { syncRepo } from "@/ingest/sync";
import { env } from "@/lib/env";
import { searchWithMode, type SearchMode } from "@/search";

const goldenSchema = z.object({
  repo: z.string(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  questions: z.array(z.object({ q: z.string(), expected: z.array(z.string()).min(1) })).min(1),
});

const K_RECALL = 5;
const K_MRR = 10;

async function main() {
  const golden = goldenSchema.parse(JSON.parse(await readFile(new URL("./golden.json", import.meta.url), "utf8")));
  const ref = parseRepoFullName(golden.repo);
  const database = db();
  const github = createGitHubClient({ token: env().GITHUB_TOKEN });
  const embedder = createOpenRouterEmbedder({ apiKey: env().OPENROUTER_API_KEY, model: env().EMBEDDING_MODEL });

  // Pin the repo to the golden commit so the expected paths are guaranteed to exist.
  let [repo] = await database.select().from(repos).where(and(eq(repos.owner, ref.owner), eq(repos.name, ref.name)));
  repo ??= (await database.insert(repos).values({ ...ref, desiredSha: golden.sha }).returning())[0];
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

  const modes: SearchMode[] = ["vector", "fts", "hybrid"];
  const rows: { mode: SearchMode; recall: number; mrr: number }[] = [];
  for (const mode of modes) {
    let found = 0;
    let rr = 0;
    for (const { q, expected } of golden.questions) {
      const hits = await searchWithMode({ query: q, scope: "source", repo: golden.repo, limit: K_MRR }, mode, { db: database, embedder });
      const rank = hits.findIndex((h) => h.kind === "source" && expected.includes(h.path));
      if (rank >= 0 && rank < K_RECALL) found++;
      if (rank >= 0) rr += 1 / (rank + 1);
    }
    rows.push({ mode, recall: found / golden.questions.length, mrr: rr / golden.questions.length });
  }

  console.log(`\n${golden.repo}@${golden.sha.slice(0, 7)} · ${golden.questions.length} questions · ${embedder.model}\n`);
  console.log(`mode     recall@${K_RECALL}  MRR@${K_MRR}`);
  for (const r of rows) console.log(`${r.mode.padEnd(8)} ${r.recall.toFixed(3).padStart(8)}  ${r.mrr.toFixed(3).padStart(6)}`);
  await database.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
