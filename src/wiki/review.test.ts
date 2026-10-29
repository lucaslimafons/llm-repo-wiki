import { beforeEach, describe, expect, it } from "vitest";
import type { Author } from "@/core/contracts";
import { repos } from "@/db/schema";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { decideProposals } from "./review";
import { createWikiStore, type WikiStoreExt } from "./store";

const human: Author = { kind: "human" };
let wikiId: string;
let store: WikiStoreExt;
const cite = (path: string) => ({ repo: "acme/api", path, commitSha: "abc1234", startLine: 1, endLine: 5 });

async function propose(title: string, parentId: string | null) {
  return store.createPage({ parentId, title, bodyMd: `# ${title}`, reason: `author-wiki abc1234: about ${title}`, citations: [cite(`${title}.ts`)], author: human, mode: "propose" });
}

beforeEach(async () => {
  await resetDb();
  wikiId = await createTestWiki();
  store = createWikiStore(testDb(), { wikiId, enqueueIndexPage: async () => {} });
  await testDb().insert(repos).values({ wikiId, owner: "acme", name: "api" });
});

describe("proposal summaries", () => {
  it("lists the queue without bodies, counts it, and filters full proposals by page or revision", async () => {
    const parent = await propose("Architecture", null);
    const child = await propose("Server", parent.pageId);

    expect(await store.countProposals()).toBe(2);
    const summaries = await store.listProposalSummaries();
    expect(summaries.map((s) => [s.pagePath, s.isNewPage, s.outdated, s.citationCount])).toEqual([
      ["Architecture", true, false, 1],
      ["Architecture/Server", true, false, 1],
    ]);
    expect(summaries[0]).not.toHaveProperty("bodyMd");

    expect((await store.listProposals({ pageId: child.pageId })).map((p) => p.pagePath)).toEqual(["Architecture/Server"]);
    expect((await store.listProposals({ revisionId: parent.revisionId }))[0]).toMatchObject({ bodyMd: "# Architecture", currentBodyMd: "" });
  });
});

describe("decideProposals", () => {
  it("accepts parents before children, whatever order they were selected in", async () => {
    const parent = await propose("Architecture", null);
    const child = await propose("Server", parent.pageId);

    const result = await decideProposals(store, [child.revisionId, parent.revisionId], true);

    expect(result).toEqual({ done: 2, failed: [] });
    expect(await store.countProposals()).toBe(0);
    expect((await store.getPage({ path: "Architecture/Server" }))?.revisionId).toBe(child.revisionId);
  });

  it("rejects children first so an emptied new parent is removed, and reports a failure without stopping", async () => {
    const parent = await propose("Guides", null);
    const child = await propose("Setup", parent.pageId);
    const kept = await store.createPage({ parentId: null, title: "Overview", bodyMd: "v1", reason: "x", citations: [], author: human, mode: "apply" });
    const outdated = await store.updatePage({ pageId: kept.pageId, bodyMd: "agent", reason: "x", citations: [], author: human, mode: "propose" });
    await store.updatePage({ pageId: kept.pageId, bodyMd: "human", reason: "x", citations: [], author: human, mode: "apply" });

    const rejected = await decideProposals(store, [parent.revisionId, child.revisionId], false);
    expect(rejected).toEqual({ done: 2, failed: [] });
    expect(await store.getPage({ path: "Guides" })).toBeNull();

    const accepted = await decideProposals(store, [outdated.revisionId], true);
    expect(accepted.done).toBe(0);
    expect(accepted.failed).toEqual([expect.objectContaining({ path: "Overview", error: expect.stringContaining("outdated") })]);
  });
});
