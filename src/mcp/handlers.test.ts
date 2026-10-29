import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchHit } from "@/core/contracts";
import { repos } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { createWikiStore } from "@/wiki/store";
import {
  readPageInputSchema,
  readPageTool,
  repoStatusTool,
  searchInputSchema,
  searchTool,
  syncRepoInputSchema,
  syncRepoTool,
  type McpDeps,
} from "./handlers";
import { SERVER_INSTRUCTIONS } from "./instructions";

const db = testDb();
const SHA = "a".repeat(40);
const NEWER = "b".repeat(40);
const store = createWikiStore(db, { enqueueIndexPage: async () => {} });

function hit(over: Partial<Extract<SearchHit, { kind: "source" }>> = {}): SearchHit {
  return {
    kind: "source",
    chunkId: "00000000-0000-4000-8000-000000000001",
    repo: "acme/api",
    path: "src/quota.ts",
    startLine: 10,
    endLine: 20,
    commitSha: SHA,
    symbol: "refill",
    content: "export function refill() {}",
    score: 1,
    ...over,
  };
}

function deps(hits: SearchHit[] = [hit()], synced: string[] = []): McpDeps {
  return {
    db,
    store,
    search: async () => hits,
    syncRepo: async (id) => (synced.push(id), { ok: true, data: undefined }),
  };
}

async function proposeQuotaPage() {
  return store.createPage({
    parentId: null,
    title: "Billing",
    bodyMd: `Refills weekly [quota.ts](source:acme/api/src/quota.ts#L10-L20@${SHA}).`,
    reason: "test",
    citations: [{ repo: "acme/api", path: "src/quota.ts", commitSha: SHA, startLine: 10, endLine: 20 }],
    author: { kind: "human" },
    mode: "propose",
  });
}

beforeEach(async () => {
  await resetDb();
  await db.insert(repos).values({ owner: "acme", name: "api", defaultBranch: "main", syncedSha: SHA, desiredSha: SHA, status: "idle" });
});

describe("search_knowledge", () => {
  it("returns permalinks, the proposals citing each file, and freshness", async () => {
    await proposeQuotaPage();
    const out = await searchTool(deps(), searchInputSchema.parse({ query: "refill" }));
    expect(out).toContain("[1] acme/api/src/quota.ts#L10-L20 @ aaaaaaa · refill");
    expect(out).toContain(`permalink: https://github.com/acme/api/blob/${SHA}/src/quota.ts#L10-L20`);
    expect(out).toContain("wiki pages citing this file: Billing (unreviewed proposal)");
    expect(out).toContain('<retrieved source="acme/api/src/quota.ts#L10-L20">');
    expect(out).toContain("- acme/api: indexed at aaaaaaa, current with the latest seen head");
  });

  it("says when the branch moved past the index, so the client syncs or reads files", async () => {
    await db.update(repos).set({ desiredSha: NEWER }).where(eq(repos.owner, "acme"));
    const out = await searchTool(deps(), searchInputSchema.parse({ query: "refill" }));
    expect(out).toContain("indexed at aaaaaaa, but the branch moved to bbbbbbb: call sync_repo or read the files directly");
  });

  it("strips invisible characters and caps each snippet", async () => {
    const out = await searchTool(deps([hit({ content: `a​b‮c${"x".repeat(2_000)}` })]), searchInputSchema.parse({ query: "q" }));
    expect(out).toContain("abc");
    expect(out).not.toMatch(/[​‮]/);
    expect(out).toContain("(truncated: open the permalink or read the file for the rest)");
  });

  it("points at grep when nothing matches", async () => {
    expect(await searchTool(deps([]), searchInputSchema.parse({ query: "nothing" }))).toContain("grep the repo directly");
  });
});

describe("search_knowledge: compact profile", () => {
  it("keeps the best hit per file, five by default, with short snippets", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ chunkId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, path: `src/f${Math.floor(i / 2)}.ts`, content: "y".repeat(900) }),
    );
    const asked: number[] = [];
    const d = { ...deps(many), search: async (input: { limit?: number }) => (asked.push(input.limit ?? 0), many) };
    const out = await searchTool(d, searchInputSchema.parse({ query: "q" }));
    expect(asked).toEqual([15]);
    expect(out.match(/^\[\d+\] /gm)).toHaveLength(5);
    expect(new Set(out.match(/src\/f\d\.ts#/g))).toHaveProperty("size", 5);
    expect(out).toContain("(truncated");
    expect(out.match(/y+/g)!.every((run) => run.length <= 500)).toBe(true);
  });

  it("the full profile still returns every chunk the search ranked", async () => {
    const two = [hit({ path: "src/a.ts" }), hit({ chunkId: "00000000-0000-4000-8000-000000000002", path: "src/a.ts", startLine: 30, endLine: 40 })];
    const out = await searchTool({ ...deps(two), profile: "full" }, searchInputSchema.parse({ query: "q" }));
    expect(out.match(/^\[\d+\] /gm)).toHaveLength(2);
  });
});

describe("read_page", () => {
  it("returns a proposal-only page labelled, with app links rewritten to permalinks", async () => {
    await proposeQuotaPage();
    const out = await readPageTool(deps(), readPageInputSchema.parse({ path: "Billing" }));
    expect(out).toContain("UNREVIEWED PROPOSAL");
    expect(out).toContain(`[quota.ts](https://github.com/acme/api/blob/${SHA}/src/quota.ts#L10-L20)`);
    expect(out).not.toContain("source:acme");
  });

  it("names list_pages when the path is unknown", async () => {
    expect(await readPageTool(deps(), readPageInputSchema.parse({ path: "Nope" }))).toContain("Call list_pages");
  });
});

describe("repo_status and sync_repo", () => {
  it("reports each repo's indexed commit", async () => {
    expect(await repoStatusTool(deps())).toContain("acme/api (main): indexed at aaaaaaa, current with the latest seen head");
  });

  it("queues a sync for an indexed repo, case-insensitively, and refuses an unknown one", async () => {
    const synced: string[] = [];
    const [row] = await db.select({ id: repos.id }).from(repos);
    expect(await syncRepoTool(deps([], synced), syncRepoInputSchema.parse({ repo: "ACME/api" }))).toContain("Queued a sync of acme/api");
    expect(synced).toEqual([row.id]);
    expect(await syncRepoTool(deps([], synced), syncRepoInputSchema.parse({ repo: "other/repo" }))).toContain("is not indexed");
  });
});

it("keeps the server instructions under Claude Code's 4,096-character cut", () => {
  expect(SERVER_INSTRUCTIONS.length).toBeLessThan(4_096);
});
