import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chunks, repos } from "@/db/schema";
import { GitHubError } from "@/github/client";
import { fakeEmbedding, resetDb, testDb } from "@/test/db";
import { pollRepos } from "./poll";
import { addRepo, listRepos, removeRepo, syncRepoNow } from "./repos";
import { fakeGitHub, sha } from "./test-helpers";

const db = testDb();

function deps(head = sha(1)) {
  const gh = fakeGitHub({ [head]: {} }, { head });
  const enqueued: string[] = [];
  return { gh, enqueued, deps: { db, github: gh.client, enqueueSync: async (id: string) => enqueued.push(id) } };
}

describe("repo management", () => {
  beforeEach(resetDb);

  it("addRepo validates, records the default branch and head, and enqueues a sync", async () => {
    const t = deps();
    const res = await addRepo(t.deps, "https://github.com/acme/widgets");
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(repos);
    expect(row).toMatchObject({ owner: "acme", name: "widgets", defaultBranch: "main", desiredSha: sha(1), status: "queued" });
    expect(t.enqueued).toEqual([row.id]);
    expect(await listRepos(db)).toEqual([
      expect.objectContaining({ id: row.id, fullName: "acme/widgets", status: "queued", fileCount: 0, lastSyncedAt: null }),
    ]);
  });

  it("refuses bad names and duplicates (case-insensitively)", async () => {
    const t = deps();
    expect(await addRepo(t.deps, "not a repo")).toMatchObject({ ok: false });
    expect(await addRepo(t.deps, 42)).toMatchObject({ ok: false });
    await addRepo(t.deps, "acme/widgets");
    expect(await addRepo(t.deps, "ACME/Widgets")).toEqual({ ok: false, error: "ACME/Widgets is already added." });
    expect(t.enqueued).toHaveLength(1);
  });

  it("explains a repo GitHub cannot see", async () => {
    const t = deps();
    t.deps.github.getRepo = async () => {
      throw new GitHubError("GitHub 404", 404);
    };
    expect(await addRepo(t.deps, "acme/secret")).toEqual({ ok: false, error: "acme/secret was not found (private repos need GITHUB_TOKEN)." });
    expect(await db.select().from(repos)).toEqual([]);
  });

  it("removeRepo cascades to chunks; syncRepoNow refreshes desired_sha and enqueues", async () => {
    const t = deps(sha(9));
    const [r] = await db.insert(repos).values({ owner: "acme", name: "widgets", defaultBranch: "main" }).returning();
    expect(await syncRepoNow(t.deps, r.id)).toEqual({ ok: true, data: undefined });
    expect((await db.select().from(repos))[0]).toMatchObject({ desiredSha: sha(9), status: "queued" });
    expect(t.enqueued).toEqual([r.id]);

    await db.insert(chunks).values({
      repoId: r.id, path: "a.ts", kind: "code", startLine: 1, endLine: 1, content: "x", embeddedText: "x",
      contentHash: "h", commitSha: sha(9), embeddingModel: "m", embedding: fakeEmbedding(1),
    });
    expect(await removeRepo(t.deps, "not-a-uuid")).toMatchObject({ ok: false });
    expect(await removeRepo(t.deps, r.id)).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(chunks).where(eq(chunks.repoId, r.id))).toEqual([]);
    expect(await syncRepoNow(t.deps, r.id)).toEqual({ ok: false, error: "Repository not found." });
  });
});

describe("pollRepos", () => {
  beforeEach(resetDb);

  it("enqueues only repos whose head moved, and keeps polling past a failing one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = deps(sha(2));
    const [moved] = await db.insert(repos).values({ owner: "a", name: "moved", defaultBranch: "main", desiredSha: sha(1), syncedSha: sha(1) }).returning();
    await db.insert(repos).values({ owner: "a", name: "same", defaultBranch: "main", desiredSha: sha(2), syncedSha: sha(2) });
    await db.insert(repos).values({ owner: "a", name: "broken", defaultBranch: "main" });
    const real = t.deps.github.getHeadSha;
    t.deps.github.getHeadSha = async (ref, branch) => {
      if (ref.name === "broken") throw new Error("boom");
      return real(ref, branch);
    };

    expect(await pollRepos(t.deps)).toEqual({ polled: 3, enqueued: 1 });
    expect(t.enqueued).toEqual([moved.id]);
    const [row] = await db.select().from(repos).where(eq(repos.id, moved.id));
    expect(row).toMatchObject({ desiredSha: sha(2), status: "queued" });
    expect(row.lastPolledAt).not.toBeNull();
  });
});
