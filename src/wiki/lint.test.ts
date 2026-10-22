import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Author, Citation } from "@/core/contracts";
import { repos, sourceFiles, wikiLog } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { findLintIssues, runLint } from "./lint";
import { createWikiStore } from "./store";

const human: Author = { kind: "human" };
const store = createWikiStore(testDb(), { enqueueIndexPage: async () => {} });
const cite = (path: string): Citation => ({ repo: "acme/api", path, commitSha: "abc1234" });
const create = async (title: string, parentId: string | null, bodyMd: string, citations: Citation[] = []) =>
  (await store.createPage({ parentId, title, bodyMd, reason: "t", citations, author: human, mode: "apply" })).pageId;

beforeEach(resetDb);

describe("lint-wiki", () => {
  it("finds orphans, dead links, uncited pages and citations to deleted files", async () => {
    const [repo] = await testDb().insert(repos).values({ owner: "acme", name: "api", syncedSha: "abc1234" }).returning();
    await testDb().insert(sourceFiles).values({ repoId: repo.id, path: "src/live.ts", contentHash: "h", indexedSha: "abc1234" });
    const root = await create("Root", null, "ok", [cite("src/live.ts")]);
    const linked = await create("Linked", root, "", [cite("src/live.ts")]);
    await store.updatePage({
      pageId: root,
      bodyMd: `[x](wiki:${linked}) [gone](wiki:00000000-0000-4000-8000-000000000000)`,
      reason: "t", citations: [cite("src/live.ts")], author: human, mode: "apply",
    });
    await create("Lonely", root, "no links", [cite("src/deleted.ts")]);

    const findings = await findLintIssues(testDb());
    expect(findings.map((f) => [f.kind, f.path])).toEqual([
      ["dead_link", "Root"],
      ["deleted_citation", "Root/Lonely"],
      ["orphan", "Root/Lonely"],
    ]);

    await runLint(testDb());
    const logged = await testDb().select().from(wikiLog).where(eq(wikiLog.action, "lint.finding"));
    expect(logged).toHaveLength(3);
  });

  it("flags pages with no citations", async () => {
    await create("Bare", null, "claims");
    expect(await findLintIssues(testDb())).toEqual([expect.objectContaining({ kind: "no_citations", path: "Bare" })]);
  });
});
