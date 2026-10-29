import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { runAuthorJob } from "@/agent/author";
import { createChat, getChat, listChats } from "@/agent/chat-store";
import { startAgentRun } from "@/agent/runs";
import { createFakeStore } from "@/agent/testing/fake-store";
import type { ScopedSearch } from "@/core/contracts";
import { chunks, repos, wikiChunks, wikiLog } from "@/db/schema";
import { loadExportPages } from "@/export/export";
import { indexPage } from "@/ingest/index-page";
import { addRepo, listRepos, removeRepo } from "@/ingest/repos";
import { fakeEmbedder } from "@/ingest/test-helpers";
import { getJobsOverview } from "@/jobs/overview";
import { listPagesTool, repoStatusTool, searchInputSchema, searchTool, type McpDeps } from "@/mcp/handlers";
import { getProjectContext } from "@/project/context";
import { hydrateByKey, rank, searchKnowledge } from "@/search";
import { explainSearch } from "@/search/explain";
import { createTestWiki, fakeEmbedding, resetDb, testDb } from "@/test/db";
import { findLintIssues } from "@/wiki/lint";
import { createWikiStore, type WikiStoreExt } from "@/wiki/store";

/**
 * The leak this feature exists to prevent: two wikis hold the same words, and nothing in wiki A
 * may ever surface wiki B's repos, pages, proposals, chats or history.
 */
const db = testDb();
const embedder = fakeEmbedder();
const SHA = "c".repeat(40);
const QUERY = "token refresh";
const human = { kind: "human" } as const;

type Side = { wikiId: string; repoId: string; chunkId: string; pageId: string; revisionId: string; store: WikiStoreExt };

async function seed(slug: string, repoName: string): Promise<Side> {
  const wikiId = await createTestWiki(slug, slug.toUpperCase());
  const [repo] = await db.insert(repos).values({ wikiId, owner: "acme", name: repoName, syncedSha: SHA }).returning({ id: repos.id });
  const content = `export function tokenRefresh() { /* token refresh in ${repoName} */ }`;
  const [chunk] = await db
    .insert(chunks)
    .values({
      repoId: repo.id,
      path: "src/auth.ts",
      kind: "code",
      startLine: 1,
      endLine: 1,
      content,
      embeddedText: content,
      contentHash: `${repoName}:auth`,
      commitSha: SHA,
      embeddingModel: embedder.model,
      embedding: fakeEmbedding(1),
    })
    .returning({ id: chunks.id });
  const store = createWikiStore(db, { wikiId, enqueueIndexPage: async () => {} });
  // Same root title in both wikis: titles are unique per wiki, not globally.
  const { pageId, revisionId } = await store.createPage({
    parentId: null,
    title: "Overview",
    bodyMd: `# Overview\n\nHow token refresh works in ${repoName}.`,
    reason: "seed",
    citations: [{ repo: `acme/${repoName}`, path: "src/auth.ts", commitSha: SHA, startLine: 1, endLine: 1 }],
    author: human,
    mode: "apply",
  });
  await indexPage({ db, embedder }, { pageId, revisionId });
  return { wikiId, repoId: repo.id, chunkId: chunk.id, pageId, revisionId, store };
}

async function wikiChunkIds(pageId: string) {
  const rows = await db.select({ id: wikiChunks.id }).from(wikiChunks).where(eq(wikiChunks.pageId, pageId));
  return rows.map((r) => r.id);
}

let a: Side;
let b: Side;
let bProposal: string;

beforeEach(async () => {
  await resetDb();
  a = await seed("a", "alpha");
  b = await seed("b", "beta");
  bProposal = (
    await b.store.updatePage({ pageId: b.pageId, bodyMd: "# Overview\n\nProposed in B.", reason: "b proposal", citations: [], author: human, mode: "propose" })
  ).revisionId;
  const run = await startAgentRun(db, { wikiId: b.wikiId, kind: "chat", model: "b-model" });
  await run.finish({ status: "succeeded" });
  await db.insert(wikiLog).values({ wikiId: b.wikiId, actor: "agent", action: "repo.synced", repoId: b.repoId, details: {} });
});

const searchA: ScopedSearch = (input) => searchKnowledge({ ...input, wikiId: a.wikiId }, { db, embedder });

describe("wiki isolation", () => {
  it("search sees only its own wiki's code and pages, even when asked for the other's repo", async () => {
    const hits = await searchA({ query: QUERY, scope: "all", limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      if (h.kind === "source") expect(h.repo).toBe("acme/alpha");
      else expect(h.pageId).toBe(a.pageId);
    }
    expect(await searchA({ query: QUERY, scope: "all", repo: "acme/beta" })).toEqual([]);
  });

  it("the other wiki's rows never enter the ranking, so they cannot take a candidate slot", async () => {
    const { rows } = await rank({ wikiId: a.wikiId, query: QUERY, scope: "all" }, 50, "hybrid", { db, embedder });
    expect(rows.map((r) => r.id).sort()).toEqual([a.chunkId, ...(await wikiChunkIds(a.pageId))].sort());
  });

  it("chunk keys from the client resolve only inside the wiki", async () => {
    const byKey = await hydrateByKey(db, a.wikiId, [
      { kind: "source", id: b.chunkId, score: 1 },
      { kind: "source", id: a.chunkId, score: 1 },
    ]);
    expect([...byKey.keys()]).toEqual([`source:${a.chunkId}`]);
    const explained = await explainSearch(a.wikiId, { query: QUERY }, { db, embedder });
    expect(explained.fused.every((i) => (i.hit.kind === "source" ? i.hit.repo === "acme/alpha" : i.hit.pageId === a.pageId))).toBe(true);
  });

  it("the store cannot read, change or review another wiki's pages by id or path", async () => {
    expect((await a.store.listTree()).map((n) => n.id)).toEqual([a.pageId]);
    expect((await a.store.getPage({ path: "Overview" }))?.id).toBe(a.pageId);
    expect(await a.store.getPage({ id: b.pageId })).toBeNull();
    expect(await a.store.listRevisions(b.pageId)).toEqual([]);
    expect(await a.store.listProposalSummaries()).toEqual([]);
    expect(await a.store.listProposals({ revisionId: bProposal })).toEqual([]);
    expect(await a.store.countProposals()).toBe(0);
    await expect(a.store.acceptRevision(bProposal)).rejects.toMatchObject({ code: "not_found" });
    await expect(a.store.rejectRevision(bProposal)).rejects.toMatchObject({ code: "not_found" });
    await expect(a.store.revertToRevision(b.revisionId, human)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      a.store.updatePage({ pageId: b.pageId, bodyMd: "x", reason: "x", citations: [], author: human, mode: "apply" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(a.store.listRevisionDetails(b.pageId)).rejects.toMatchObject({ code: "not_found" });
    expect(await b.store.countProposals()).toBe(1);
  });

  it("a page cannot cite another wiki's repo", async () => {
    await expect(
      a.store.createPage({
        parentId: null,
        title: "Leak",
        bodyMd: "x",
        reason: "x",
        citations: [{ repo: "acme/beta", path: "src/auth.ts", commitSha: SHA }],
        author: human,
        mode: "apply",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("lint, export, chats, brief and repos stay inside the wiki", async () => {
    const lint = await findLintIssues(db, a.wikiId);
    expect(lint.every((f) => f.pageId === a.pageId)).toBe(true);
    expect((await loadExportPages(db, a.wikiId)).map((p) => p.id)).toEqual([a.pageId]);

    const bChat = await createChat(db, b.wikiId);
    expect(await listChats(db, a.wikiId)).toEqual([]);
    expect(await getChat(db, a.wikiId, bChat.id)).toBeNull();

    expect((await getProjectContext(db, a.wikiId)).repos.map((r) => r.fullName)).toEqual(["acme/alpha"]);
    expect((await listRepos(db, a.wikiId)).map((r) => r.fullName)).toEqual(["acme/alpha"]);
    expect(await removeRepo({ db }, a.wikiId, b.repoId)).toEqual({ ok: false, error: "Repository not found." });
  });

  it("refuses a repo that already belongs to another wiki, naming it", async () => {
    const github = new Proxy({}, { get: () => () => Promise.reject(new Error("GitHub must not be called")) });
    const result = await addRepo({ db, github: github as never, enqueueSync: async () => {} }, a.wikiId, "acme/beta");
    expect(result).toEqual({ ok: false, error: 'acme/beta already belongs to the wiki "B".' });
  });

  it("the jobs page shows only the wiki's runs and activity", async () => {
    const overview = await getJobsOverview(db, a.wikiId);
    expect(overview.runs).toEqual([]);
    expect(overview.totalCostUsd).toBe(0);
    expect(overview.activity.every((e) => e.repo !== "acme/beta")).toBe(true);
    expect(overview.pipelines.map((p) => p.fullName)).toEqual(["acme/alpha"]);
  });

  it("the MCP tools answer from their own wiki only", async () => {
    const deps: McpDeps = { db, wikiId: a.wikiId, store: a.store, search: searchA, syncRepo: async () => ({ ok: true, data: undefined }) };
    const out = [
      await searchTool(deps, searchInputSchema.parse({ query: QUERY, scope: "all" })),
      await listPagesTool(deps),
      await repoStatusTool(deps),
    ].join("\n");
    expect(out).toContain("acme/alpha");
    expect(out).not.toContain("acme/beta");
  });

  it("the author job builds its store and search for its repo's wiki", async () => {
    const asked: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("stop after setup");
      },
    });
    await runAuthorJob(
      {
        db,
        model,
        storeFor: (wikiId) => (asked.push(`store:${wikiId}`), createFakeStore().store),
        searchFor: (wikiId) => (asked.push(`search:${wikiId}`), async () => []),
      },
      { repoId: a.repoId, fromSha: null, toSha: SHA, changedPaths: [] },
    ).catch(() => {});
    expect(asked).toEqual([`store:${a.wikiId}`, `search:${a.wikiId}`]);
  });
});
