import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Author, Citation } from "@/core/contracts";
import { agentRuns, pageRevisions, pages, repos, wikiLog } from "@/db/schema";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { WikiError } from "./errors";
import { createWikiStore, type WikiStoreExt } from "./store";

const human: Author = { kind: "human" };
let enqueued: { pageId: string; revisionId: string }[] = [];
let wikiId: string;
let store: WikiStoreExt;

const cite = (path: string, extra: Partial<Citation> = {}): Citation => ({
  repo: "acme/api",
  path,
  commitSha: "abc1234",
  startLine: 1,
  endLine: 5,
  ...extra,
});

async function page(title: string, parentId: string | null = null, opts: { body?: string; citations?: Citation[] } = {}) {
  const r = await store.createPage({
    parentId,
    title,
    bodyMd: opts.body ?? `# ${title}`,
    reason: "test",
    citations: opts.citations ?? [],
    author: human,
    mode: "apply",
  });
  return r.pageId;
}

async function rejects(p: Promise<unknown>, code: WikiError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WikiError);
  expect((err as WikiError).code).toBe(code);
}

async function sortKeys(parentId: string | null) {
  const rows = await testDb().select().from(pages).orderBy(asc(pages.sortKey));
  return rows.filter((r) => r.parentId === parentId).map((r) => [r.title, r.sortKey]);
}

let repoId: string;
beforeEach(async () => {
  await resetDb();
  enqueued = [];
  wikiId = await createTestWiki();
  store = createWikiStore(testDb(), { wikiId, enqueueIndexPage: async (job) => void enqueued.push(job) });
  [{ id: repoId }] = await testDb().insert(repos).values({ wikiId, owner: "acme", name: "api" }).returning({ id: repos.id });
});

describe("tree", () => {
  it("nests pages, orders siblings by sort_key and builds display paths", async () => {
    const arch = await page("Architecture");
    await page("Overview");
    await page("Ingest", arch);
    await page("Search", arch);
    const tree = await store.listTree();
    expect(tree.map((n) => n.title)).toEqual(["Architecture", "Overview"]);
    expect(tree[0].children.map((n) => n.path)).toEqual(["Architecture/Ingest", "Architecture/Search"]);
    expect((await store.getPage({ path: "Architecture/Search" }))?.title).toBe("Search");
    expect(await store.getPage({ path: "Nope" })).toBeNull();
  });

  it("refuses a duplicate sibling title, case-insensitively", async () => {
    await page("Guides");
    await rejects(page("guides"), "title_taken");
  });

  it("refuses a page whose full path exceeds 235 characters", async () => {
    const parent = await page("p".repeat(200));
    await rejects(page("c".repeat(35), parent), "invalid");
    await expect(page("c".repeat(34), parent)).resolves.toBeTypeOf("string");
  });
});

describe("movePage", () => {
  it("refuses moving a page under itself or its descendant", async () => {
    const a = await page("A");
    const b = await page("B", a);
    const c = await page("C", b);
    await rejects(store.movePage({ pageId: a, newParentId: c, author: human }), "cycle");
    await rejects(store.movePage({ pageId: a, newParentId: a, author: human }), "cycle");
  });

  it("keeps sort keys dense in both the old and the new parent", async () => {
    const a = await page("A");
    const b = await page("B");
    const c = await page("C");
    const d = await page("D");
    await store.movePage({ pageId: b, newParentId: d, author: human });
    expect(await sortKeys(null)).toEqual([["A", 0], ["C", 1], ["D", 2]]);
    await store.movePage({ pageId: c, newParentId: d, index: 0, author: human });
    expect(await sortKeys(d)).toEqual([["C", 0], ["B", 1]]);
    await store.movePage({ pageId: a, newParentId: null, index: 5, author: human });
    expect(await sortKeys(null)).toEqual([["D", 0], ["A", 1]]);
  });

  it("refuses a move that collides with a sibling title", async () => {
    const a = await page("A");
    await page("Setup", a);
    const other = await page("Setup");
    await rejects(store.movePage({ pageId: other, newParentId: a, author: human }), "title_taken");
  });
});

describe("deletePage", () => {
  it("refuses a page with children, then deletes once it has none", async () => {
    const a = await page("A");
    const b = await page("B", a);
    await rejects(store.deletePage({ pageId: a, author: human }), "has_children");
    await store.deletePage({ pageId: b, author: human });
    await store.deletePage({ pageId: a, author: human });
    expect(await store.listTree()).toEqual([]);
  });
});

describe("revisions", () => {
  it("propose → accept makes the revision current, clears stale and enqueues index-page", async () => {
    const id = await page("A", null, { body: "v1" });
    enqueued = [];
    await testDb().update(pages).set({ stale: true }).where(eq(pages.id, id));
    const { revisionId } = await store.updatePage({
      pageId: id, bodyMd: "v2", reason: "sync", citations: [cite("src/a.ts")], author: human, mode: "propose",
    });
    expect((await store.getPage({ id }))?.bodyMd).toBe("v1");
    expect((await store.listTree())[0].hasPendingProposal).toBe(true);
    expect(enqueued).toEqual([]);

    await store.acceptRevision(revisionId);
    const view = await store.getPage({ id });
    expect(view).toMatchObject({ revisionId, bodyMd: "v2", stale: false });
    expect(view?.citations).toEqual([cite("src/a.ts")]);
    expect(enqueued).toEqual([{ pageId: id, revisionId }]);
    expect((await store.listTree())[0].hasPendingProposal).toBe(false);
  });

  it("a proposed new page is pending in the tree with no current revision until accepted", async () => {
    const { pageId, revisionId } = await store.createPage({
      parentId: null, title: "Draft", bodyMd: "body", reason: "outline", citations: [], author: human, mode: "propose",
    });
    expect(await store.getPage({ id: pageId })).toMatchObject({ revisionId: null, bodyMd: "" });
    expect((await store.listTree())[0]).toMatchObject({ title: "Draft", hasPendingProposal: true });
    await store.acceptRevision(revisionId);
    expect(await store.getPage({ id: pageId })).toMatchObject({ revisionId, bodyMd: "body" });
  });

  it("reject leaves the current revision alone; rejecting a new page's only proposal removes it", async () => {
    const id = await page("A", null, { body: "v1" });
    const { revisionId } = await store.updatePage({
      pageId: id, bodyMd: "v2", reason: "x", citations: [], author: human, mode: "propose",
    });
    await store.rejectRevision(revisionId);
    expect((await store.getPage({ id }))?.bodyMd).toBe("v1");
    expect((await store.listRevisions(id)).map((r) => r.status).sort()).toEqual(["accepted", "rejected"]);
    await rejects(store.acceptRevision(revisionId), "invalid");

    const draft = await store.createPage({
      parentId: null, title: "Draft", bodyMd: "b", reason: "x", citations: [], author: human, mode: "propose",
    });
    await store.rejectRevision(draft.revisionId);
    expect(await store.getPage({ id: draft.pageId })).toBeNull();
  });

  it("detects a concurrent update against the same base revision", async () => {
    const id = await page("A", null, { body: "v1" });
    const base = (await store.getPage({ id }))!.revisionId;
    await store.updatePage({ pageId: id, bodyMd: "mine", reason: "x", citations: [], author: human, mode: "apply", baseRevisionId: base });
    await rejects(
      store.updatePage({ pageId: id, bodyMd: "theirs", reason: "x", citations: [], author: human, mode: "apply", baseRevisionId: base }),
      "conflict",
    );
    expect((await store.getPage({ id }))?.bodyMd).toBe("mine");
  });

  it("refuses to accept an outdated proposal (documented: reject, never rebase)", async () => {
    const id = await page("A", null, { body: "v1" });
    const proposal = await store.updatePage({
      pageId: id, bodyMd: "agent", reason: "x", citations: [], author: human, mode: "propose",
    });
    await store.updatePage({ pageId: id, bodyMd: "human", reason: "x", citations: [], author: human, mode: "apply" });
    expect((await store.listProposals())[0]).toMatchObject({ id: proposal.revisionId, outdated: true });
    await rejects(store.acceptRevision(proposal.revisionId), "conflict");
    expect((await store.getPage({ id }))?.bodyMd).toBe("human");
  });

  it("revert creates a new accepted revision with the old body", async () => {
    const id = await page("A", null, { body: "v1", citations: [cite("a.ts")] });
    const v1 = (await store.getPage({ id }))!.revisionId!;
    await store.updatePage({ pageId: id, bodyMd: "v2", reason: "x", citations: [], author: human, mode: "apply" });
    const { revisionId } = await store.revertToRevision(v1, human);
    expect(revisionId).not.toBe(v1);
    expect(await store.getPage({ id })).toMatchObject({ revisionId, bodyMd: "v1", citations: [cite("a.ts")] });
    expect(await store.listRevisions(id)).toHaveLength(3);
  });

  it("refuses a citation to an unknown repo", async () => {
    await rejects(page("A", null, { citations: [cite("a.ts", { repo: "ghost/repo" })] }), "invalid");
    expect(await store.listTree()).toEqual([]);
  });
});

describe("markStaleByFiles", () => {
  it("marks only pages whose CURRENT revision cites the path", async () => {
    const cites = await page("Cites", null, { citations: [cite("src/a.ts")] });
    await page("Other", null, { citations: [cite("src/b.ts")] });
    const old = await page("Old", null, { citations: [cite("src/a.ts")] });
    await store.updatePage({ pageId: old, bodyMd: "new", reason: "x", citations: [cite("src/c.ts")], author: human, mode: "apply" });
    const proposedOnly = await page("Proposed");
    await store.updatePage({
      pageId: proposedOnly, bodyMd: "p", reason: "x", citations: [cite("src/a.ts")], author: human, mode: "propose",
    });

    expect(await store.markStaleByFiles(repoId, ["src/a.ts", "src/z.ts"])).toEqual([cites]);
    const stale = (await store.listTree()).filter((n) => n.stale).map((n) => n.title);
    expect(stale).toEqual(["Cites"]);
    expect(await store.staleFiles(cites)).toEqual(["src/a.ts"]);
  });
});

describe("wiki_log", () => {
  it("appends one row per write with the author's kind", async () => {
    const [run] = await testDb().insert(agentRuns).values({ wikiId, kind: "author", model: "m" }).returning();
    const agent: Author = { kind: "agent", agentRunId: run.id };
    const a = await page("A");
    const b = await page("B");
    const { revisionId } = await store.updatePage({ pageId: a, bodyMd: "x", reason: "r", citations: [], author: agent, mode: "propose" });
    await store.acceptRevision(revisionId);
    await store.movePage({ pageId: b, newParentId: a, author: human });
    await store.deletePage({ pageId: b, author: human });
    const rows = await testDb().select().from(wikiLog).orderBy(asc(wikiLog.at));
    expect(rows.map((r) => [r.action, r.actor])).toEqual([
      ["page.created", "human"],
      ["page.created", "human"],
      ["revision.proposed", "agent"],
      ["revision.accepted", "human"],
      ["page.moved", "human"],
      ["page.deleted", "human"],
    ]);
    const [rev] = await testDb().select().from(pageRevisions).where(eq(pageRevisions.id, revisionId));
    expect(rev.agentRunId).toBe(run.id);
  });
});
