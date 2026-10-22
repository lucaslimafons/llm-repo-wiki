import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { repos, sourceFiles } from "@/db/schema";
import { GitHubError, type GitHubClient } from "@/github/client";
import { formatRepo, repoFullNameSchema } from "@/github/repo-name";

/** A running sync re-reads desired_sha when it finishes, so never flip it back to "queued". */
export const queuedUnlessSyncing = sql<"queued">`case when ${repos.status} = 'syncing' then ${repos.status} else 'queued' end`;

export type RepoListItem = {
  id: string;
  fullName: string;
  defaultBranch: string | null;
  status: "idle" | "queued" | "syncing" | "error";
  desiredSha: string | null;
  syncedSha: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  fileCount: number;
};

export async function listRepos(db: Db): Promise<RepoListItem[]> {
  const rows = await db
    .select({
      id: repos.id,
      owner: repos.owner,
      name: repos.name,
      defaultBranch: repos.defaultBranch,
      status: repos.status,
      desiredSha: repos.desiredSha,
      syncedSha: repos.syncedSha,
      lastError: repos.lastError,
      lastSyncedAt: repos.lastSyncedAt,
      fileCount: sql<number>`(select count(*)::int from ${sourceFiles} where ${sourceFiles.repoId} = ${repos.id})`,
    })
    .from(repos)
    .orderBy(asc(repos.owner), asc(repos.name));
  return rows.map(({ owner, name, lastSyncedAt, ...r }) => ({
    ...r,
    fullName: formatRepo({ owner, name }),
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  }));
}

export type RepoDeps = { db: Db; github: GitHubClient; enqueueSync: (repoId: string) => Promise<unknown> };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const repoIdSchema = z.uuid();

export async function addRepo(deps: RepoDeps, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = repoFullNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use the form owner/name (e.g. vercel/next.js)." };
  const ref = parsed.data;
  // GitHub names are case-insensitive; the unique constraint is not.
  const [dupe] = await deps.db
    .select({ id: repos.id })
    .from(repos)
    .where(and(sql`lower(${repos.owner}) = lower(${ref.owner})`, sql`lower(${repos.name}) = lower(${ref.name})`));
  if (dupe) return { ok: false, error: `${formatRepo(ref)} is already added.` };
  try {
    const { defaultBranch } = await deps.github.getRepo(ref);
    const head = await deps.github.getHeadSha(ref, defaultBranch);
    const [row] = await deps.db
      .insert(repos)
      .values({ owner: ref.owner, name: ref.name, defaultBranch, desiredSha: head, status: "queued" })
      .onConflictDoNothing()
      .returning({ id: repos.id });
    if (!row) return { ok: false, error: `${formatRepo(ref)} is already added.` };
    await deps.enqueueSync(row.id);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: githubMessage(err, formatRepo(ref)) };
  }
}

export async function removeRepo(deps: Pick<RepoDeps, "db">, input: unknown): Promise<ActionResult> {
  const id = repoIdSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid repository id." };
  // Cascades to source_files, chunks and revision_sources; wiki_log keeps its rows (set null).
  const gone = await deps.db.delete(repos).where(eq(repos.id, id.data)).returning({ id: repos.id });
  return gone.length ? { ok: true, data: undefined } : { ok: false, error: "Repository not found." };
}

export async function syncRepoNow(deps: RepoDeps, input: unknown): Promise<ActionResult> {
  const id = repoIdSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Invalid repository id." };
  const [repo] = await deps.db.select().from(repos).where(eq(repos.id, id.data));
  if (!repo) return { ok: false, error: "Repository not found." };
  const ref = { owner: repo.owner, name: repo.name };
  try {
    const branch = repo.defaultBranch ?? (await deps.github.getRepo(ref)).defaultBranch;
    const head = await deps.github.getHeadSha(ref, branch);
    await deps.db
      .update(repos)
      .set({ defaultBranch: branch, desiredSha: head, status: queuedUnlessSyncing, lastError: null })
      .where(eq(repos.id, repo.id));
    await deps.enqueueSync(repo.id);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: githubMessage(err, formatRepo(ref)) };
  }
}

function githubMessage(err: unknown, name: string): string {
  if (err instanceof GitHubError && err.status === 404) return `${name} was not found (private repos need GITHUB_TOKEN).`;
  if (err instanceof GitHubError && (err.status === 403 || err.status === 429)) return `GitHub refused the request: ${err.message}`;
  return (err as Error).message;
}
