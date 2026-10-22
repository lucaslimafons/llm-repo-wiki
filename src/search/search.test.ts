import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { chunks, pageRevisions, pages, repos, revisionSources } from "@/db/schema";
import { indexPage } from "@/ingest/index-page";
import { fakeEmbedder } from "@/ingest/test-helpers";
import { resetDb, testDb } from "@/test/db";
import { searchKnowledge, searchWithMode } from ".";

const db = testDb();
const DIMS = 1536;
const QUERY = "token refresh";

/** Unit vector mixing two axes, so cosine distances to e0 are controlled exactly. */
function axis(a: number, weight = 0, b = 1): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[a] = 1;
  v[b] += weight;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

async function repo(owner: string, name: string) {
  const [r] = await db.insert(repos).values({ owner, name }).returning({ id: repos.id });
  return r.id;
}

async function chunk(repoId: string, path: string, content: string, embedding: number[], startLine = 1) {
  const [c] = await db
    .insert(chunks)
    .values({
      repoId,
      path,
      kind: "code",
      startLine,
      endLine: startLine + content.split("\n").length - 1,
      content,
      embeddedText: content,
      contentHash: `${path}:${content}`,
      commitSha: "c".repeat(40),
      embeddingModel: "fake-embedding",
      embedding,
    })
    .returning({ id: chunks.id });
  return c.id;
}

describe("searchKnowledge", () => {
  beforeEach(resetDb);
  const embedder = fakeEmbedder({ [QUERY]: axis(0) });

  it("RRF: a chunk ranked well by both retrievers beats one ranked first by only one", async () => {
    const r = await repo("acme", "auth");
    // Nearest vector, but none of the query's words.
    const vectorOnly = await chunk(r, "src/session.ts", "export function renew() {}", axis(0));
    // Second-nearest vector, and the best full-text match.
    const both = await chunk(r, "src/auth.ts", "export function tokenRefresh() { /* token refresh */ }", axis(0, 0.6));
    // Far vector, no full-text match.
    await chunk(r, "docs/notes.ts", "// unrelated", axis(2));

    const vectorHits = await searchWithMode({ query: QUERY, scope: "source" }, "vector", { db, embedder });
    expect(vectorHits[0]).toMatchObject({ chunkId: vectorOnly });
    const ftsHits = await searchWithMode({ query: QUERY, scope: "source" }, "fts", { db, embedder });
    expect(ftsHits.map((h) => h.kind === "source" && h.chunkId)).toEqual([both]);

    const hits = await searchKnowledge({ query: QUERY, scope: "source" }, { db, embedder });
    expect(hits.map((h) => h.kind === "source" && h.chunkId).slice(0, 2)).toEqual([both, vectorOnly]);
    expect(hits[0].score).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(hits[1].score).toBeCloseTo(1 / 61, 10);
    expect(hits[0]).toMatchObject({ kind: "source", repo: "acme/auth", path: "src/auth.ts", startLine: 1, endLine: 1, commitSha: "c".repeat(40) });
  });

  it("matches natural-language questions on any term, ranking chunks with more terms first", async () => {
    const r = await repo("acme", "auth");
    const one = await chunk(r, "src/a.ts", "the token is stored", axis(3));
    const two = await chunk(r, "src/b.ts", "refresh the token before expiry", axis(4));
    await chunk(r, "src/c.ts", "how do we do it", axis(5));
    const hits = await searchWithMode({ query: "How do I refresh a token?", scope: "source" }, "fts", { db, embedder });
    expect(hits.map((h) => h.kind === "source" && h.chunkId)).toEqual([two, one]);
    // websearch syntax still works: an excluded term removes the chunk.
    const excluded = await searchWithMode({ query: "token -expiry", scope: "source" }, "fts", { db, embedder });
    expect(excluded.map((h) => h.kind === "source" && h.chunkId)).toEqual([one]);
  });

  it("filters by repo, case-insensitively, and returns nothing for an unknown repo", async () => {
    const a = await repo("acme", "auth");
    const b = await repo("acme", "billing");
    await chunk(a, "src/a.ts", "token refresh in auth", axis(0));
    const inB = await chunk(b, "src/b.ts", "token refresh in billing", axis(0, 0.1));

    const hits = await searchKnowledge({ query: QUERY, scope: "source", repo: "ACME/billing" }, { db, embedder });
    expect(hits.map((h) => h.kind === "source" && h.chunkId)).toEqual([inB]);
    expect(await searchKnowledge({ query: QUERY, scope: "source", repo: "acme/nope" }, { db, embedder })).toEqual([]);
  });

  it("respects the limit and validates input", async () => {
    const r = await repo("acme", "auth");
    for (let i = 0; i < 5; i++) await chunk(r, `src/f${i}.ts`, `token refresh ${i}`, axis(0, i / 10));
    expect(await searchKnowledge({ query: QUERY, scope: "source", limit: 3 }, { db, embedder })).toHaveLength(3);
    await expect(searchKnowledge({ query: " ", scope: "source" }, { db, embedder })).rejects.toThrow();
    await expect(searchKnowledge({ query: QUERY, scope: "source", repo: "../x" }, { db, embedder })).rejects.toThrow();
  });

  describe("wiki scope", () => {
    async function page(title: string, parentId: string | null, body: string, citesRepo?: string) {
      const [p] = await db.insert(pages).values({ title, parentId }).returning({ id: pages.id });
      const [rev] = await db
        .insert(pageRevisions)
        .values({ pageId: p.id, title, bodyMd: body, authorKind: "human", status: "accepted" })
        .returning({ id: pageRevisions.id });
      await db.update(pages).set({ currentRevisionId: rev.id }).where(eq(pages.id, p.id));
      if (citesRepo) await db.insert(revisionSources).values({ revisionId: rev.id, repoId: citesRepo, path: "src/auth.ts", commitSha: "c".repeat(40) });
      return { pageId: p.id, revisionId: rev.id };
    }

    it("indexes accepted pages and returns hits with the page path and heading path", async () => {
      const r = await repo("acme", "auth");
      await chunk(r, "src/auth.ts", "token refresh code", axis(5));
      const arch = await page("Architecture", null, "# Architecture\n\nOverview.");
      const auth = await page("Auth", arch.pageId, "# Auth\n\nIntro.\n\n## Token refresh\n\nThe token refresh flow renews sessions.", r);
      const wikiEmbedder = fakeEmbedder();
      expect(await indexPage({ db, embedder: wikiEmbedder }, auth)).toEqual({ status: "indexed", chunks: 2 });
      expect(wikiEmbedder.texts[1].startsWith("wiki/Architecture/Auth > Auth > Token refresh\n\n")).toBe(true);
      await indexPage({ db, embedder: wikiEmbedder }, arch);

      const wikiHits = await searchKnowledge({ query: QUERY, scope: "wiki" }, { db, embedder });
      expect(wikiHits[0]).toMatchObject({ kind: "wiki", pageId: auth.pageId, pagePath: "Architecture/Auth", headingPath: "Auth > Token refresh" });
      expect(wikiHits.every((h) => h.kind === "wiki")).toBe(true);

      const all = await searchKnowledge({ query: QUERY, scope: "all" }, { db, embedder });
      expect(new Set(all.map((h) => h.kind))).toEqual(new Set(["source", "wiki"]));

      // A repo filter keeps only pages whose revision cites that repo.
      const filtered = await searchKnowledge({ query: "overview", scope: "wiki", repo: "acme/auth" }, { db, embedder });
      expect(filtered.every((h) => h.kind === "wiki" && h.pageId === auth.pageId)).toBe(true);
    });

    it("index-page skips a revision that is not the page's current accepted one", async () => {
      const p = await page("Solo", null, "# Solo\n\nText.");
      const [old] = await db
        .insert(pageRevisions)
        .values({ pageId: p.pageId, title: "Solo", bodyMd: "old", authorKind: "human", status: "accepted" })
        .returning({ id: pageRevisions.id });
      expect(await indexPage({ db, embedder: fakeEmbedder() }, { pageId: p.pageId, revisionId: old.id })).toMatchObject({ status: "skipped" });
      const [proposed] = await db
        .insert(pageRevisions)
        .values({ pageId: p.pageId, title: "Solo", bodyMd: "draft", authorKind: "agent", status: "proposed" })
        .returning({ id: pageRevisions.id });
      expect(await indexPage({ db, embedder: fakeEmbedder() }, { pageId: p.pageId, revisionId: proposed.id })).toEqual({
        status: "skipped",
        reason: "revision is proposed",
      });
    });

    it("re-indexing replaces the page's previous chunks", async () => {
      const p = await page("Solo", null, "# Solo\n\nA.\n\n## Two\n\nB.");
      const e = fakeEmbedder();
      await indexPage({ db, embedder: e }, p);
      await indexPage({ db, embedder: e }, p);
      const hits = await searchKnowledge({ query: "Solo", scope: "wiki" }, { db, embedder });
      expect(hits).toHaveLength(2);
    });
  });
});
