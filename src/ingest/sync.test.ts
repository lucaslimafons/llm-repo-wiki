import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobPayloads } from "@/core/contracts";
import { chunks, repos, sourceFiles, wikiLog } from "@/db/schema";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { createDefaultChunker } from "./chunk";
import { syncRepo, type SyncDeps } from "./sync";
import { fakeEmbedder, fakeGitHub, sha, type Snapshot } from "./test-helpers";

const db = testDb();
let wikiId: string;
const chunker = createDefaultChunker();

const readme = `# Widgets

Intro.

## Install

Run pnpm add widgets.

## Usage

Call makeWidget().
`;
const code = `export function makeWidget(name: string) {\n  return { name };\n}\n`;

async function addRepo(desired: string) {
  const [row] = await db
    .insert(repos)
    .values({ wikiId, owner: "acme", name: "widgets", defaultBranch: "main", desiredSha: desired, status: "queued" })
    .returning();
  return row.id;
}

function setup(commits: Record<string, Snapshot>) {
  const gh = fakeGitHub(commits);
  const embedder = fakeEmbedder();
  const authored: JobPayloads["author-wiki"][] = [];
  const stale: string[][] = [];
  const requeued: string[] = [];
  const deps: SyncDeps = {
    db,
    github: gh.client,
    embedder,
    chunker,
    markStaleByFiles: async (_id, paths) => {
      stale.push(paths);
      return [];
    },
    enqueueAuthor: async (p) => authored.push(p),
    enqueueSync: async (id) => requeued.push(id),
  };
  return { gh, embedder, deps, authored, stale, requeued };
}

const chunkRows = (repoId: string) =>
  db.select().from(chunks).where(eq(chunks.repoId, repoId)).orderBy(asc(chunks.path), asc(chunks.startLine));
const repoRow = async (id: string) => (await db.select().from(repos).where(eq(repos.id, id)))[0];

describe("syncRepo", () => {
  beforeEach(async () => {
    await resetDb();
    wikiId = await createTestWiki();
  });
  afterEach(() => vi.restoreAllMocks());

  it("first sync is full: indexes every file, advances synced_sha, logs, and asks for authoring", async () => {
    const commits = { [sha(1)]: { "README.md": readme, "src/widget.ts": code, "node_modules/x/i.js": "x", "pnpm-lock.yaml": "y" } };
    const t = setup(commits);
    const id = await addRepo(sha(1));

    const result = await syncRepo(t.deps, id);

    expect(result).toMatchObject({ status: "synced", fromSha: null, toSha: sha(1), changedPaths: ["README.md", "src/widget.ts"] });
    const rows = await chunkRows(id);
    expect(new Set(rows.map((r) => r.path))).toEqual(new Set(["README.md", "src/widget.ts"]));
    expect(rows.every((r) => r.commitSha === sha(1) && r.embeddingModel === "fake-embedding")).toBe(true);
    expect(rows.find((r) => r.symbol === "Widgets > Install")).toMatchObject({ startLine: 5, endLine: 7, kind: "doc" });
    expect(await repoRow(id)).toMatchObject({ syncedSha: sha(1), status: "idle", lastError: null });
    expect(t.authored).toEqual([{ repoId: id, fromSha: null, toSha: sha(1), changedPaths: ["README.md", "src/widget.ts"] }]);
    const [log] = await db.select().from(wikiLog).where(eq(wikiLog.action, "repo.synced"));
    expect(log).toMatchObject({ actor: "agent", action: "repo.synced", repoId: id });
    expect(log.details).toMatchObject({ mode: "full", indexed: 2, toSha: sha(1) });
  });

  it("logs progress a pipeline view can follow, every event tied to one syncId", async () => {
    const t = setup({ [sha(1)]: { "README.md": readme, "src/widget.ts": code } });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);

    const logs = await db.select().from(wikiLog).orderBy(asc(wikiLog.at));
    expect(logs.map((l) => `${l.action}${l.details?.stage ? `:${l.details.stage}` : ""}`)).toEqual([
      "sync.started",
      "sync.progress:files",
      "sync.progress:index",
      "sync.progress:index",
      "sync.progress:index",
      "repo.synced",
    ]);
    expect(new Set(logs.map((l) => l.details?.syncId)).size).toBe(1);
    expect(logs[0].details).toMatchObject({ fromSha: null, toSha: sha(1), mode: "full" });
    expect(logs[1].details).toMatchObject({ downloaded: 2, kept: 2, dropped: 0, secrets: 0 });
    expect(logs[2].details).toMatchObject({ done: 0, total: 2 });
    expect(logs[4].details).toMatchObject({ done: 2, total: 2, indexed: 2, failed: 0 });
  });

  it("logs sync.failed with the run's syncId when a sync throws", async () => {
    const t = setup({ [sha(1)]: { "README.md": readme } });
    const id = await addRepo(sha(9));
    await expect(syncRepo(t.deps, id)).rejects.toThrow("no commit");
    const logs = await db.select().from(wikiLog).orderBy(asc(wikiLog.at));
    expect(logs.map((l) => l.action)).toEqual(["sync.started", "sync.failed"]);
    expect(logs[1].details).toMatchObject({ syncId: logs[0].details?.syncId, error: expect.stringContaining("no commit") });
  });

  it("is a no-op when synced_sha already equals desired_sha", async () => {
    const t = setup({ [sha(1)]: { "src/widget.ts": code } });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    const calls = t.embedder.calls;
    expect(await syncRepo(t.deps, id)).toEqual({ status: "up-to-date", sha: sha(1) });
    expect(t.embedder.calls).toBe(calls);
    expect(t.gh.state.compares).toBe(0);
  });

  it("rename with the same content moves the path without re-embedding", async () => {
    const t = setup({
      [sha(1)]: { "README.md": readme, "src/widget.ts": code },
      [sha(2)]: { "README.md": readme, "src/widgets/make.ts": code },
    });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    const before = (await chunkRows(id)).filter((r) => r.path === "src/widget.ts");
    const embeddedBefore = t.embedder.texts.length;

    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
    const result = await syncRepo(t.deps, id);

    expect(t.embedder.texts.length).toBe(embeddedBefore);
    expect(result).toMatchObject({ status: "synced", changedPaths: ["src/widget.ts", "src/widgets/make.ts"] });
    const after = (await chunkRows(id)).filter((r) => r.path.startsWith("src/"));
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.every((r) => r.path === "src/widgets/make.ts" && r.commitSha === sha(2))).toBe(true);
    const files = await db.select().from(sourceFiles).where(eq(sourceFiles.repoId, id));
    expect(files.map((f) => f.path).sort()).toEqual(["README.md", "src/widgets/make.ts"]);
    expect(t.stale).toEqual([["README.md", "src/widget.ts"], ["src/widget.ts", "src/widgets/make.ts"]]);
  });

  it("delete removes the file's chunks and source_files row", async () => {
    const t = setup({ [sha(1)]: { "README.md": readme, "src/widget.ts": code }, [sha(2)]: { "README.md": readme } });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));

    const result = await syncRepo(t.deps, id);

    expect(result).toMatchObject({ changedPaths: ["src/widget.ts"] });
    expect((await chunkRows(id)).some((r) => r.path === "src/widget.ts")).toBe(false);
    const files = await db.select().from(sourceFiles).where(eq(sourceFiles.repoId, id));
    expect(files.map((f) => f.path)).toEqual(["README.md"]);
    expect(t.gh.state.tarballs).toBe(1);
  });

  it("modify re-embeds only the chunk hashes that changed and drops leftovers", async () => {
    const edited = readme.replace("Run pnpm add widgets.", "Run pnpm add widgets@2.\n\nThen restart.");
    const t = setup({ [sha(1)]: { "README.md": readme }, [sha(2)]: { "README.md": edited } });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    const firstRun = t.embedder.texts.length;
    const introId = (await chunkRows(id)).find((r) => r.symbol === "Widgets")!.id;

    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
    const result = await syncRepo(t.deps, id);

    const reembedded = t.embedder.texts.slice(firstRun);
    expect(reembedded).toHaveLength(1);
    expect(reembedded[0]).toContain("Then restart.");
    const rows = await chunkRows(id);
    expect(rows.map((r) => r.symbol)).toEqual(["Widgets", "Widgets > Install", "Widgets > Usage"]);
    expect(rows.find((r) => r.symbol === "Widgets")!.id).toBe(introId);
    // Unchanged chunks below the edit shifted down: their lines and commit are refreshed.
    expect(rows.find((r) => r.symbol === "Widgets > Usage")).toMatchObject({ startLine: 11, endLine: 13, commitSha: sha(2) });
    expect(result).toMatchObject({ stats: { mode: "incremental", chunksInserted: 1, chunksKept: 2, chunksDeleted: 1 } });
  });

  it("does not advance synced_sha when a file fails, and records the error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup({
      [sha(1)]: { "README.md": readme },
      [sha(2)]: { "README.md": readme, "src/a.ts": code, "src/b.ts": "export const b = 2;\n" },
    });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
    t.embedder.failWhen = (text) => text.includes("export const b");

    await expect(syncRepo(t.deps, id)).rejects.toThrow("1 file(s) failed; first src/b.ts: 429 Too Many Requests");

    const row = await repoRow(id);
    expect(row).toMatchObject({ syncedSha: sha(1), status: "error" });
    expect(row.lastError).toContain("src/b.ts");
    expect(t.authored).toHaveLength(1);
    // The file that did succeed stays committed, so the retry only re-embeds the failed one.
    expect((await chunkRows(id)).some((r) => r.path === "src/a.ts")).toBe(true);

    t.embedder.failWhen = undefined;
    const before = t.embedder.texts.length;
    await expect(syncRepo(t.deps, id)).resolves.toMatchObject({ status: "synced", toSha: sha(2) });
    expect(t.embedder.texts.slice(before).every((x) => x.includes("export const b"))).toBe(true);
    expect(await repoRow(id)).toMatchObject({ syncedSha: sha(2), status: "idle", lastError: null });
    // The retry still reports the file the failed attempt had already indexed.
    expect(t.authored.at(-1)).toMatchObject({ fromSha: sha(1), toSha: sha(2), changedPaths: ["src/a.ts", "src/b.ts"] });
  });

  it("removes an indexed file once a secret is committed to it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const leaked = `${code}const k = "${["AKIA", "IOSFODNN7EXAMPLE"].join("")}";\n`;
    const t = setup({ [sha(1)]: { "src/widget.ts": code }, [sha(2)]: { "src/widget.ts": leaked } });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));

    await syncRepo(t.deps, id);

    expect(await chunkRows(id)).toEqual([]);
    const logs = await db.select().from(wikiLog).orderBy(asc(wikiLog.at));
    expect(logs.at(-1)!.details).toMatchObject({ secretsDropped: [{ path: "src/widget.ts", rules: ["aws-access-key-id"] }] });
    expect(JSON.stringify(logs)).not.toContain("IOSFODNN7EXAMPLE");
  });

  it("applies the repo's .gitattributes linguist rules to an incremental diff", async () => {
    const t = setup({
      [sha(1)]: { ".gitattributes": "gen/** linguist-generated\n", "README.md": readme },
      [sha(2)]: { ".gitattributes": "gen/** linguist-generated\n", "README.md": readme, "gen/api.ts": code },
    });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
    await syncRepo(t.deps, id);
    expect((await chunkRows(id)).some((r) => r.path === "gen/api.ts")).toBe(false);
  });

  it("falls back to a full hash reconcile when compare is too large", async () => {
    const t = setup({
      [sha(1)]: { "README.md": readme, "src/widget.ts": code, "src/old.ts": "export const old = 1;\n" },
      [sha(2)]: { "README.md": readme, "src/widget.ts": code.replace("name }", "name, v: 2 }") },
    });
    const id = await addRepo(sha(1));
    await syncRepo(t.deps, id);
    await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
    t.gh.state.tooLarge = true;

    const result = await syncRepo(t.deps, id);

    expect(result).toMatchObject({ stats: { mode: "full", indexed: 1, unchanged: 1, removed: 1 } });
    expect(result).toMatchObject({ changedPaths: ["src/old.ts", "src/widget.ts"] });
  });

  it("re-enqueues itself when desired_sha moved during the run", async () => {
    const t = setup({ [sha(1)]: { "src/widget.ts": code }, [sha(2)]: { "src/widget.ts": code + "// v2\n" } });
    const id = await addRepo(sha(1));
    const realEmbed = t.embedder.embed;
    t.embedder.embed = async (texts) => {
      await db.update(repos).set({ desiredSha: sha(2) }).where(eq(repos.id, id));
      return realEmbed(texts);
    };

    const result = await syncRepo(t.deps, id);

    expect(result).toMatchObject({ status: "synced", toSha: sha(1), requeued: true });
    expect(t.requeued).toEqual([id]);
    expect(await repoRow(id)).toMatchObject({ syncedSha: sha(1), desiredSha: sha(2), status: "queued" });
  });

  it("a failing markStaleByFiles (the wiki stub) does not fail the sync", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup({ [sha(1)]: { "src/widget.ts": code } });
    t.deps.markStaleByFiles = async () => {
      throw new Error("wikiStore: not implemented yet");
    };
    const id = await addRepo(sha(1));
    await expect(syncRepo(t.deps, id)).resolves.toMatchObject({ status: "synced" });
    expect(t.authored).toHaveLength(1);
  });

  it("skips when another sync holds the repo's advisory lock", async () => {
    const t = setup({ [sha(1)]: { "src/widget.ts": code } });
    const id = await addRepo(sha(1));
    let inner: unknown;
    t.embedder.embed = async (texts) => {
      inner = await syncRepo(t.deps, id);
      return fakeEmbedder().embed(texts);
    };
    await syncRepo(t.deps, id);
    expect(inner).toEqual({ status: "locked" });
  });
});
