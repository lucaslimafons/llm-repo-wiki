import { and, eq, ne, notInArray, or, sql } from "drizzle-orm";
import type { JobPayloads, QUEUES } from "@/core/contracts";
import type { Db } from "@/db/client";
import { chunks, repos, sourceFiles, wikiLog } from "@/db/schema";
import type { CompareFile, GitHubClient } from "@/github/client";
import type { RepoRef } from "@/github/repo-name";
import type { ChunkDraft, Chunker } from "./chunk";
import type { Embedder } from "./embedder";
import { pathSkipReason } from "./filters";
import { acceptTarEntry, prepareFiles, sha256, type DroppedFile, type PreparedFile } from "./prepare";

export type SyncDeps = {
  db: Db;
  github: GitHubClient;
  embedder: Embedder;
  chunker: Chunker;
  /** The wiki track's `markStaleByFiles`. A failure here is logged, never fails the sync. */
  markStaleByFiles: (repoId: string, paths: string[]) => Promise<string[]>;
  enqueueAuthor: (payload: JobPayloads[typeof QUEUES.authorWiki]) => Promise<unknown>;
  enqueueSync: (repoId: string) => Promise<unknown>;
  /** Files processed in parallel (each in its own transaction). */
  concurrency?: number;
};

export type SyncStats = {
  mode: "full" | "incremental";
  indexed: number;
  unchanged: number;
  removed: number;
  renamed: number;
  dropped: number;
  chunksInserted: number;
  chunksKept: number;
  chunksDeleted: number;
  embedded: number;
};

export type SyncResult =
  | { status: "missing" | "locked" }
  | { status: "up-to-date"; sha: string }
  | { status: "synced"; fromSha: string | null; toSha: string; changedPaths: string[]; stats: SyncStats; requeued: boolean };

/**
 * One repo, one commit: brings the index from `synced_sha` to `desired_sha` (read here, not from the
 * job payload, so a coalesced job always syncs the latest head). The advisory lock is a backstop
 * for pg-boss's stately policy; the lock transaction just stays open while the work runs.
 */
export async function syncRepo(deps: SyncDeps, repoId: string): Promise<SyncResult> {
  return deps.db.transaction(async (lockTx) => {
    const [row] = await lockTx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('sync-repo'), hashtext(${repoId})) as locked`,
    );
    if (!row?.locked) return { status: "locked" } as const;
    return runSync(deps, repoId);
  });
}

async function runSync(deps: SyncDeps, repoId: string): Promise<SyncResult> {
  const { db, github } = deps;
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId));
  if (!repo) return { status: "missing" };
  const ref: RepoRef = { owner: repo.owner, name: repo.name };
  await db.update(repos).set({ status: "syncing", lastError: null }).where(eq(repos.id, repoId));

  try {
    let toSha = repo.desiredSha;
    if (!toSha) {
      const branch = repo.defaultBranch ?? (await github.getRepo(ref)).defaultBranch;
      toSha = await github.getHeadSha(ref, branch);
      await db.update(repos).set({ desiredSha: toSha, defaultBranch: branch }).where(eq(repos.id, repoId));
    }
    const fromSha = repo.syncedSha;
    if (fromSha === toSha) {
      await db.update(repos).set({ status: "idle" }).where(eq(repos.id, repoId));
      return { status: "up-to-date", sha: toSha };
    }

    const compared = fromSha ? await github.compare(ref, fromSha, toSha) : ({ tooLarge: true } as const);
    const work = new Work(deps, repoId, `${repo.owner}/${repo.name}`, toSha);

    if (compared.tooLarge) await work.full(ref);
    else await work.incremental(ref, compared.files);

    if (work.failures.length) {
      const first = work.failures[0];
      throw new Error(`${work.failures.length} file(s) failed; first ${first.path}: ${first.message}`);
    }

    const changedPaths = await work.changedPaths(compared.tooLarge ? null : compared.files);
    if (changedPaths.length) {
      try {
        await deps.markStaleByFiles(repoId, changedPaths);
      } catch (err) {
        console.warn(`[sync] markStaleByFiles failed for ${repoId}:`, (err as Error).message);
      }
      await deps.enqueueAuthor({ repoId, fromSha, toSha, changedPaths });
    }

    // synced_sha moves only now, after every file has committed.
    await db.transaction(async (tx) => {
      await tx
        .update(repos)
        .set({ syncedSha: toSha, lastSyncedAt: new Date(), lastError: null, status: "idle" })
        .where(eq(repos.id, repoId));
      await tx.insert(wikiLog).values({
        actor: "agent",
        action: "repo.synced",
        repoId,
        details: {
          fromSha,
          toSha,
          ...work.stats,
          changedPaths: changedPaths.length,
          secretsDropped: work.droppedFiles.filter((d) => d.reason === "secret").map((d) => ({ path: d.path, rules: d.rules })),
        },
      });
    });

    const [after] = await db.select({ desiredSha: repos.desiredSha }).from(repos).where(eq(repos.id, repoId));
    const requeued = !!after?.desiredSha && after.desiredSha !== toSha;
    if (requeued) {
      await db.update(repos).set({ status: "queued" }).where(eq(repos.id, repoId));
      await deps.enqueueSync(repoId);
    }
    return { status: "synced", fromSha, toSha, changedPaths, stats: work.stats, requeued };
  } catch (err) {
    await db
      .update(repos)
      .set({ status: "error", lastError: (err as Error).message.slice(0, 2000) })
      .where(eq(repos.id, repoId));
    throw err;
  }
}

type Failure = { path: string; message: string };
type Task = { path: string; run: () => Promise<void> };

class Work {
  readonly changed = new Set<string>();
  readonly failures: Failure[] = [];
  droppedFiles: DroppedFile[] = [];
  stats: SyncStats = {
    mode: "full",
    indexed: 0,
    unchanged: 0,
    removed: 0,
    renamed: 0,
    dropped: 0,
    chunksInserted: 0,
    chunksKept: 0,
    chunksDeleted: 0,
    embedded: 0,
  };

  constructor(
    private deps: SyncDeps,
    private repoId: string,
    private repoName: string,
    private sha: string,
  ) {}

  /** First sync, or compare was too large: hash-reconcile every file against source_files. */
  async full(ref: RepoRef) {
    this.stats.mode = "full";
    const raw = await this.deps.github.downloadTarball(ref, this.sha, acceptTarEntry);
    const { files, dropped } = prepareFiles(raw);
    this.noteDropped(dropped);
    const existing = await this.existingFiles();
    const tasks: Task[] = [];
    for (const path of existing.keys()) if (!files.has(path)) tasks.push({ path, run: () => this.remove(path) });
    for (const file of files.values()) tasks.push({ path: file.path, run: () => this.index(file, existing.get(file.path)) });
    await this.run(tasks);
  }

  async incremental(ref: RepoRef, diff: CompareFile[]) {
    this.stats.mode = "incremental";
    const wanted = new Set(diff.filter((f) => f.status !== "removed").map((f) => f.path));
    const raw = wanted.size
      ? await this.deps.github.downloadTarball(ref, this.sha, (p, size) => (wanted.has(p) || p === ".gitattributes") && acceptTarEntry(p, size))
      : new Map<string, Buffer>();
    const { files, dropped } = prepareFiles(raw);
    // .gitattributes rode along to classify linguist paths; index it only if it changed.
    if (!wanted.has(".gitattributes")) files.delete(".gitattributes");
    this.noteDropped(dropped);
    const existing = await this.existingFiles();

    const tasks: Task[] = [];
    for (const f of diff) {
      const file = files.get(f.path);
      if (f.status === "removed") {
        if (existing.has(f.path)) tasks.push({ path: f.path, run: () => this.remove(f.path) });
      } else if (f.status === "renamed" && f.previousPath) {
        const prev = f.previousPath;
        const prevHash = existing.get(prev);
        if (!file) {
          tasks.push({
            path: f.path,
            run: async () => {
              if (prevHash) await this.remove(prev);
              if (existing.has(f.path)) await this.remove(f.path);
            },
          });
        } else if (prevHash && prevHash === file.hash) {
          tasks.push({ path: f.path, run: () => this.rename(prev, f.path) });
        } else {
          tasks.push({
            path: f.path,
            run: async () => {
              if (prevHash) await this.remove(prev);
              await this.index(file, existing.get(f.path));
            },
          });
        }
      } else if (file) {
        tasks.push({ path: f.path, run: () => this.index(file, existing.get(f.path)) });
      } else if (existing.has(f.path)) {
        // Modified into something we refuse (a secret, a size blow-up): it must leave the index.
        tasks.push({ path: f.path, run: () => this.remove(f.path) });
      }
    }
    await this.run(tasks);
  }

  /**
   * Derived from the diff (or from indexed_sha), not from what this attempt wrote: a retry after a
   * partial failure finds the earlier files already indexed and would otherwise never report them.
   */
  async changedPaths(diff: CompareFile[] | null): Promise<string[]> {
    const out = new Set(this.changed);
    if (diff) {
      for (const f of diff) for (const p of [f.path, f.previousPath]) if (p && !pathSkipReason(p)) out.add(p);
    } else {
      const rows = await this.deps.db
        .select({ path: sourceFiles.path })
        .from(sourceFiles)
        .where(and(eq(sourceFiles.repoId, this.repoId), eq(sourceFiles.indexedSha, this.sha)));
      for (const r of rows) out.add(r.path);
    }
    return [...out].sort();
  }

  private noteDropped(dropped: DroppedFile[]) {
    this.droppedFiles = dropped;
    this.stats.dropped = dropped.length;
  }

  private async existingFiles(): Promise<Map<string, string>> {
    const rows = await this.deps.db
      .select({ path: sourceFiles.path, hash: sourceFiles.contentHash })
      .from(sourceFiles)
      .where(eq(sourceFiles.repoId, this.repoId));
    return new Map(rows.map((r) => [r.path, r.hash]));
  }

  /** Runs tasks with bounded concurrency; a failed file is recorded and the rest carry on. */
  private async run(tasks: Task[]) {
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const i = next++;
        try {
          await tasks[i].run();
        } catch (err) {
          this.failures.push({ path: tasks[i].path, message: (err as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency ?? 4, tasks.length) }, worker));
  }

  private async remove(path: string) {
    const { db } = this.deps;
    const deleted = await db.transaction(async (tx) => {
      const gone = await tx
        .delete(chunks)
        .where(and(eq(chunks.repoId, this.repoId), eq(chunks.path, path)))
        .returning({ id: chunks.id });
      await tx.delete(sourceFiles).where(and(eq(sourceFiles.repoId, this.repoId), eq(sourceFiles.path, path)));
      return gone.length;
    });
    this.stats.removed++;
    this.stats.chunksDeleted += deleted;
    this.changed.add(path);
  }

  /** Same bytes, new path: move the rows, embed nothing. */
  private async rename(from: string, to: string) {
    await this.deps.db.transaction(async (tx) => {
      await tx.delete(chunks).where(and(eq(chunks.repoId, this.repoId), eq(chunks.path, to)));
      await tx.delete(sourceFiles).where(and(eq(sourceFiles.repoId, this.repoId), eq(sourceFiles.path, to)));
      await tx
        .update(chunks)
        .set({ path: to, commitSha: this.sha })
        .where(and(eq(chunks.repoId, this.repoId), eq(chunks.path, from)));
      await tx
        .update(sourceFiles)
        .set({ path: to, indexedSha: this.sha })
        .where(and(eq(sourceFiles.repoId, this.repoId), eq(sourceFiles.path, from)));
    });
    this.stats.renamed++;
    this.changed.add(from).add(to);
  }

  /** Re-chunks a file, embeds only chunk hashes not already stored for its path, drops leftovers. */
  private async index(file: PreparedFile, existingHash: string | undefined) {
    if (existingHash === file.hash) {
      this.stats.unchanged++;
      return;
    }
    const { db, embedder, chunker } = this.deps;
    const drafts = withHashes(await chunker.chunk({ repo: this.repoName, path: file.path, text: file.text }));
    const stored = await db
      .select({ hash: chunks.contentHash })
      .from(chunks)
      .where(and(eq(chunks.repoId, this.repoId), eq(chunks.path, file.path), eq(chunks.embeddingModel, embedder.model)));
    const have = new Set(stored.map((r) => r.hash));
    const fresh = drafts.filter((d) => !have.has(d.hash));
    const kept = drafts.filter((d) => have.has(d.hash));
    // Network before the transaction: never hold a transaction open across an API call.
    const vectors = fresh.length ? await embedder.embed(fresh.map((d) => d.embeddedText)) : [];
    if (vectors.length !== fresh.length) throw new Error(`embedder returned ${vectors.length} of ${fresh.length} vectors`);
    const hashes = drafts.map((d) => d.hash);

    const deleted = await db.transaction(async (tx) => {
      const here = and(eq(chunks.repoId, this.repoId), eq(chunks.path, file.path));
      const gone = await tx
        .delete(chunks)
        .where(
          and(here, hashes.length ? or(notInArray(chunks.contentHash, hashes), ne(chunks.embeddingModel, embedder.model)) : undefined),
        )
        .returning({ id: chunks.id });
      // Kept chunks may have moved within the file: refresh their lines and commit.
      for (const d of kept) {
        await tx
          .update(chunks)
          .set({ startLine: d.startLine, endLine: d.endLine, symbol: d.symbol, commitSha: this.sha })
          .where(and(here, eq(chunks.contentHash, d.hash)));
      }
      if (fresh.length) {
        await tx.insert(chunks).values(
          fresh.map((d, i) => ({
            repoId: this.repoId,
            path: file.path,
            kind: d.kind,
            lang: d.lang,
            symbol: d.symbol,
            startLine: d.startLine,
            endLine: d.endLine,
            content: d.content,
            embeddedText: d.embeddedText,
            contentHash: d.hash,
            commitSha: this.sha,
            embeddingModel: embedder.model,
            embedding: vectors[i],
          })),
        );
      }
      await tx
        .insert(sourceFiles)
        .values({ repoId: this.repoId, path: file.path, contentHash: file.hash, lang: file.lang, indexedSha: this.sha })
        .onConflictDoUpdate({
          target: [sourceFiles.repoId, sourceFiles.path],
          set: { contentHash: file.hash, lang: file.lang, indexedSha: this.sha },
        });
      return gone.length;
    });

    this.stats.indexed++;
    this.stats.embedded += fresh.length;
    this.stats.chunksInserted += fresh.length;
    this.stats.chunksKept += kept.length;
    this.stats.chunksDeleted += deleted;
    this.changed.add(file.path);
  }
}

/** Hash of what gets embedded; a repeat within one file gets an occurrence suffix to stay unique. */
export function withHashes(drafts: ChunkDraft[]): (ChunkDraft & { hash: string })[] {
  const seen = new Map<string, number>();
  return drafts.map((d) => {
    const base = sha256(d.embeddedText);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...d, hash: n ? sha256(`${base}#${n}`) : base };
  });
}

