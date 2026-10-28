import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  QUEUES,
  type Author,
  type Citation,
  type CreatePageInput,
  type MovePageInput,
  type PageView,
  type RevisionSummary,
  type UpdatePageInput,
  type WikiStore,
} from "@/core/contracts";
import { db as appDb, type Db } from "@/db/client";
import { pageRevisions, pages, repos, revisionSources, wikiLog } from "@/db/schema";
import { enqueue } from "@/jobs/queue";
import { isForeignKeyViolation, isUniqueViolation, pgErrorCode, WikiError } from "./errors";
import { fullPathSchema, joinPath, pageTitleSchema } from "./title";
import { buildTree, childrenOf, computePaths, descendantIds, type OutlineRow } from "./tree";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Q = Db | Tx;

export type WikiStoreDeps = {
  enqueueIndexPage: (job: { pageId: string; revisionId: string }) => Promise<unknown>;
};

/** `baseRevisionId`: the revision the writer read. A different current revision is a conflict. */
export type UpdatePageWithBase = UpdatePageInput & { baseRevisionId?: string | null };

export type RevisionDetail = RevisionSummary & {
  title: string;
  bodyMd: string;
  parentRevisionId: string | null;
  citations: Citation[];
  isCurrent: boolean;
};

export type ProposalView = RevisionDetail & {
  pagePath: string;
  /** The page has never had an accepted revision: accepting creates it. */
  isNewPage: boolean;
  currentTitle: string;
  currentBodyMd: string;
  /** The page moved on since this was proposed; accepting it is refused (reject and re-propose). */
  outdated: boolean;
};

export type ProposalSummary = RevisionSummary & {
  title: string;
  pagePath: string;
  isNewPage: boolean;
  outdated: boolean;
  citationCount: number;
};

export type WikiStoreExt = WikiStore & {
  updatePage(input: UpdatePageWithBase): Promise<{ revisionId: string }>;
  revertToRevision(revisionId: string, author: Author): Promise<{ revisionId: string }>;
  listRevisionDetails(pageId: string): Promise<RevisionDetail[]>;
  /** Full proposals (bodies and the current body, for a diff), optionally for one page or revision. */
  listProposals(filter?: { pageId?: string; revisionId?: string }): Promise<ProposalView[]>;
  /** The review queue without bodies: cheap enough to load whole. */
  listProposalSummaries(): Promise<ProposalSummary[]>;
  countProposals(): Promise<number>;
  /** id → display path for every page, for resolving `wiki:` links. */
  pagePaths(): Promise<Record<string, string>>;
  /** Files whose change marked this page stale since its current revision. */
  staleFiles(pageId: string): Promise<string[]>;
};

const LOCK_KEY = sql`hashtext('llm-repo-wiki:pages')`;

/** Serializes wiki writes: cycle, sibling-title and sort-key checks read-then-write the tree. */
async function lockWiki(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
}

function parseTitle(raw: string): string {
  const r = pageTitleSchema.safeParse(raw);
  if (!r.success) throw new WikiError("invalid", r.error.issues[0]?.message ?? "Invalid title");
  return r.data;
}

function checkPathLength(path: string) {
  const r = fullPathSchema.safeParse(path);
  if (!r.success) throw new WikiError("invalid", `${r.error.issues[0]?.message}: "${path}"`);
}

const actorOf = (a: Author) => a.kind;
const agentRunOf = (a: Author) => (a.kind === "agent" ? a.agentRunId : null);

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof WikiError) throw err;
    if (isUniqueViolation(err)) throw new WikiError("title_taken", "A sibling page already has this title");
    if (isForeignKeyViolation(err)) throw new WikiError("invalid", "A referenced agent run, repo or page does not exist");
    if (pgErrorCode(err) === "22P02") throw new WikiError("not_found", "Malformed id");
    throw err;
  }
}

async function loadOutline(q: Q): Promise<OutlineRow[]> {
  return q
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      sortKey: pages.sortKey,
      stale: pages.stale,
      currentRevisionId: pages.currentRevisionId,
      // Raw qualified name: drizzle renders ${pages.id} unqualified here, which binds to r.id.
      hasPendingProposal: sql<boolean>`exists (select 1 from page_revisions r
        where r.page_id = "pages"."id" and r.status = 'proposed')`,
    })
    .from(pages);
}

function mustGet(rows: OutlineRow[], id: string): OutlineRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new WikiError("not_found", `Page ${id} not found`);
  return row;
}

/** Case-insensitive, so the export never writes two files that collide on macOS/Windows. */
function assertTitleFree(rows: OutlineRow[], parentId: string | null, title: string, exceptId?: string) {
  const lower = title.toLowerCase();
  const clash = rows.find((r) => r.parentId === parentId && r.id !== exceptId && r.title.toLowerCase() === lower);
  if (clash) throw new WikiError("title_taken", `A sibling page is already titled "${clash.title}"`);
}

/** The page and every descendant still fit the path cap once the page lives at `newPath`. */
function assertSubtreeFits(rows: OutlineRow[], pageId: string, newPath: string) {
  checkPathLength(newPath);
  const paths = computePaths(rows);
  const oldPath = paths.get(pageId) ?? "";
  for (const id of descendantIds(rows, pageId)) {
    checkPathLength(newPath + paths.get(id)!.slice(oldPath.length));
  }
}

async function renumber(tx: Tx, ordered: OutlineRow[], parentId: string | null) {
  for (const [i, row] of ordered.entries()) {
    if (row.sortKey !== i || row.parentId !== parentId) {
      await tx.update(pages).set({ sortKey: i, parentId }).where(eq(pages.id, row.id));
    }
  }
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** owner/name → repos.id. An unknown repo or a malformed citation is refused, never dropped. */
async function resolveCitations(q: Q, citations: Citation[]) {
  if (citations.length === 0) return [];
  const names = [...new Set(citations.map((c) => c.repo))];
  const rows = await q
    .select({ id: repos.id, full: sql<string>`${repos.owner} || '/' || ${repos.name}` })
    .from(repos)
    .where(inArray(sql`${repos.owner} || '/' || ${repos.name}`, names));
  const byName = new Map(rows.map((r) => [r.full, r.id]));
  return citations.map((c) => {
    const repoId = byName.get(c.repo);
    if (!repoId) throw new WikiError("invalid", `Unknown repo "${c.repo}" in citation`);
    if (!c.path || c.path.split("/").some((s) => s === "" || s === ".." || s === "."))
      throw new WikiError("invalid", `Invalid citation path "${c.path}"`);
    if (!SHA_RE.test(c.commitSha)) throw new WikiError("invalid", `Invalid commit sha "${c.commitSha}"`);
    const start = c.startLine ?? null;
    const end = c.endLine ?? start;
    if (start !== null && (start < 1 || end === null || end < start))
      throw new WikiError("invalid", `Invalid line range in citation for "${c.path}"`);
    return { repoId, path: c.path, commitSha: c.commitSha, startLine: start, endLine: end };
  });
}

async function citationsByRevision(q: Q, revisionIds: string[]): Promise<Map<string, Citation[]>> {
  const out = new Map<string, Citation[]>();
  if (revisionIds.length === 0) return out;
  const rows = await q
    .select({
      revisionId: revisionSources.revisionId,
      repo: sql<string>`${repos.owner} || '/' || ${repos.name}`,
      path: revisionSources.path,
      commitSha: revisionSources.commitSha,
      startLine: revisionSources.startLine,
      endLine: revisionSources.endLine,
    })
    .from(revisionSources)
    .innerJoin(repos, eq(repos.id, revisionSources.repoId))
    .where(inArray(revisionSources.revisionId, revisionIds))
    .orderBy(asc(revisionSources.path), asc(revisionSources.startLine));
  for (const r of rows) {
    const list = out.get(r.revisionId) ?? [];
    list.push({
      repo: r.repo,
      path: r.path,
      commitSha: r.commitSha,
      ...(r.startLine !== null ? { startLine: r.startLine } : {}),
      ...(r.endLine !== null ? { endLine: r.endLine } : {}),
    });
    out.set(r.revisionId, list);
  }
  return out;
}

type RevisionRow = typeof pageRevisions.$inferSelect;

function toSummary(r: RevisionRow): RevisionSummary {
  return {
    id: r.id,
    pageId: r.pageId,
    status: r.status,
    authorKind: r.authorKind,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  };
}

export function createWikiStore(database: Db | (() => Db), deps: WikiStoreDeps): WikiStoreExt {
  const d = () => (typeof database === "function" ? database() : database);

  /** After commit, so the job never reads a revision that is not visible yet. Search is rebuildable. */
  async function index(pageId: string, revisionId: string) {
    try {
      await deps.enqueueIndexPage({ pageId, revisionId });
    } catch (err) {
      console.error("[wiki] enqueue index-page failed", { pageId, revisionId }, err);
    }
  }

  async function log(
    q: Q,
    entry: { actor: "agent" | "human"; action: string; pageId?: string | null; repoId?: string | null; details?: Record<string, unknown> },
  ) {
    await q.insert(wikiLog).values({
      actor: entry.actor,
      action: entry.action,
      pageId: entry.pageId ?? null,
      repoId: entry.repoId ?? null,
      details: entry.details ?? null,
    });
  }

  async function insertRevision(
    tx: Tx,
    v: {
      pageId: string;
      parentRevisionId: string | null;
      title: string;
      bodyMd: string;
      author: Author;
      reason: string | null;
      status: "proposed" | "accepted";
      citations: Citation[];
    },
  ) {
    const sources = await resolveCitations(tx, v.citations);
    const [rev] = await tx
      .insert(pageRevisions)
      .values({
        pageId: v.pageId,
        parentRevisionId: v.parentRevisionId,
        title: v.title,
        bodyMd: v.bodyMd,
        authorKind: v.author.kind,
        agentRunId: agentRunOf(v.author),
        reason: v.reason,
        status: v.status,
      })
      .returning({ id: pageRevisions.id });
    if (sources.length) {
      await tx.insert(revisionSources).values(sources.map((s) => ({ ...s, revisionId: rev.id })));
    }
    return rev.id;
  }

  async function updatePage(input: UpdatePageWithBase, logAction?: string) {
    return guard(async () => {
      // Read before taking the lock: a write that lands in between is a concurrent update.
      const base =
        input.baseRevisionId !== undefined
          ? input.baseRevisionId
          : ((await d().select({ c: pages.currentRevisionId }).from(pages).where(eq(pages.id, input.pageId)))[0]?.c ?? null);
      const result = await d().transaction(async (tx) => {
        await lockWiki(tx);
        const rows = await loadOutline(tx);
        const page = mustGet(rows, input.pageId);
        if (page.currentRevisionId !== base) {
          throw new WikiError("conflict", "The page changed since you read it. Reload it and apply your edit again.");
        }
        const title = input.title === undefined ? page.title : parseTitle(input.title);
        if (title !== page.title) {
          assertTitleFree(rows, page.parentId, title, page.id);
          const parentPath = page.parentId ? computePaths(rows).get(page.parentId)! : null;
          assertSubtreeFits(rows, page.id, joinPath(parentPath, title));
        }
        const apply = input.mode === "apply";
        const revisionId = await insertRevision(tx, {
          pageId: page.id,
          parentRevisionId: page.currentRevisionId,
          title,
          bodyMd: input.bodyMd,
          author: input.author,
          reason: input.reason,
          status: apply ? "accepted" : "proposed",
          citations: input.citations,
        });
        if (apply) {
          await tx
            .update(pages)
            .set({ currentRevisionId: revisionId, title, stale: false, updatedAt: new Date() })
            .where(eq(pages.id, page.id));
        }
        await log(tx, {
          actor: actorOf(input.author),
          action: logAction ?? (apply ? "page.updated" : "revision.proposed"),
          pageId: page.id,
          details: { revisionId, reason: input.reason, ...(title !== page.title ? { from: page.title, to: title } : {}) },
        });
        return { revisionId, apply, pageId: page.id };
      });
      if (result.apply) await index(result.pageId, result.revisionId);
      return { revisionId: result.revisionId };
    });
  }

  const store: WikiStoreExt = {
    async listTree() {
      return buildTree(await loadOutline(d()));
    },

    async getPage(ref) {
      return guard(async () => {
        const rows = await loadOutline(d());
        const paths = computePaths(rows);
        const row =
          "id" in ref ? rows.find((r) => r.id === ref.id) : rows.find((r) => paths.get(r.id) === ref.path);
        if (!row) return null;
        const [page] = await d().select().from(pages).where(eq(pages.id, row.id));
        const rev = row.currentRevisionId
          ? (await d().select().from(pageRevisions).where(eq(pageRevisions.id, row.currentRevisionId)))[0]
          : undefined;
        const cites = rev ? ((await citationsByRevision(d(), [rev.id])).get(rev.id) ?? []) : [];
        const view: PageView = {
          id: row.id,
          title: row.title,
          path: paths.get(row.id)!,
          parentId: row.parentId,
          stale: row.stale,
          revisionId: rev?.id ?? null,
          bodyMd: rev?.bodyMd ?? "",
          citations: cites,
          updatedAt: page.updatedAt.toISOString(),
        };
        return view;
      });
    },

    async createPage(input: CreatePageInput) {
      return guard(async () => {
        const title = parseTitle(input.title);
        const apply = input.mode === "apply";
        const result = await d().transaction(async (tx) => {
          await lockWiki(tx);
          const rows = await loadOutline(tx);
          const parentPath = input.parentId ? (mustGet(rows, input.parentId), computePaths(rows).get(input.parentId)!) : null;
          checkPathLength(joinPath(parentPath, title));
          assertTitleFree(rows, input.parentId, title);
          const [page] = await tx
            .insert(pages)
            .values({ parentId: input.parentId, title, sortKey: childrenOf(rows, input.parentId).length })
            .returning({ id: pages.id });
          const revisionId = await insertRevision(tx, {
            pageId: page.id,
            parentRevisionId: null,
            title,
            bodyMd: input.bodyMd,
            author: input.author,
            reason: input.reason,
            status: apply ? "accepted" : "proposed",
            citations: input.citations,
          });
          if (apply) await tx.update(pages).set({ currentRevisionId: revisionId }).where(eq(pages.id, page.id));
          await log(tx, {
            actor: actorOf(input.author),
            action: apply ? "page.created" : "revision.proposed",
            pageId: page.id,
            details: { revisionId, title, parentId: input.parentId, reason: input.reason, newPage: true },
          });
          return { pageId: page.id, revisionId };
        });
        if (apply) await index(result.pageId, result.revisionId);
        return result;
      });
    },

    updatePage: (input) => updatePage(input),

    async movePage(input: MovePageInput) {
      return guard(async () => {
        await d().transaction(async (tx) => {
          await lockWiki(tx);
          const rows = await loadOutline(tx);
          const page = mustGet(rows, input.pageId);
          const to = input.newParentId;
          if (to !== null) {
            mustGet(rows, to);
            if (to === page.id || descendantIds(rows, page.id).has(to)) {
              throw new WikiError("cycle", "A page cannot move under itself or one of its descendants");
            }
          }
          if (to !== page.parentId) {
            assertTitleFree(rows, to, page.title, page.id);
            const parentPath = to ? computePaths(rows).get(to)! : null;
            assertSubtreeFits(rows, page.id, joinPath(parentPath, page.title));
            await renumber(tx, childrenOf(rows, page.parentId).filter((r) => r.id !== page.id), page.parentId);
          }
          const siblings = childrenOf(rows, to).filter((r) => r.id !== page.id);
          const index = Math.max(0, Math.min(input.index ?? siblings.length, siblings.length));
          siblings.splice(index, 0, page);
          await renumber(tx, siblings, to);
          await tx.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, page.id));
          await log(tx, {
            actor: actorOf(input.author),
            action: "page.moved",
            pageId: page.id,
            details: { fromParentId: page.parentId, toParentId: to, index },
          });
        });
      });
    },

    async deletePage({ pageId, author }) {
      return guard(async () => {
        await d().transaction(async (tx) => {
          await lockWiki(tx);
          const rows = await loadOutline(tx);
          const page = mustGet(rows, pageId);
          if (rows.some((r) => r.parentId === pageId)) {
            throw new WikiError("has_children", "Move or delete this page's children first");
          }
          const path = computePaths(rows).get(pageId);
          await tx.delete(pages).where(eq(pages.id, pageId));
          await renumber(tx, childrenOf(rows, page.parentId).filter((r) => r.id !== pageId), page.parentId);
          await log(tx, { actor: actorOf(author), action: "page.deleted", details: { pageId, title: page.title, path } });
        });
      });
    },

    async listRevisions(pageId) {
      return guard(async () => {
        const rows = await d()
          .select()
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, pageId))
          .orderBy(desc(pageRevisions.createdAt), desc(pageRevisions.id));
        return rows.map(toSummary);
      });
    },

    /** Refuses a proposal whose parent revision is no longer current: no silent rebase of prose. */
    async acceptRevision(revisionId) {
      return guard(async () => {
        const result = await d().transaction(async (tx) => {
          await lockWiki(tx);
          const [rev] = await tx.select().from(pageRevisions).where(eq(pageRevisions.id, revisionId));
          if (!rev) throw new WikiError("not_found", `Revision ${revisionId} not found`);
          if (rev.status !== "proposed") throw new WikiError("invalid", `Revision is ${rev.status}, not proposed`);
          const rows = await loadOutline(tx);
          const page = mustGet(rows, rev.pageId);
          if (rev.parentRevisionId !== page.currentRevisionId) {
            throw new WikiError("conflict", "This proposal is outdated: the page changed after it was written. Reject it and re-propose.");
          }
          if (rev.title !== page.title) {
            assertTitleFree(rows, page.parentId, rev.title, page.id);
            const parentPath = page.parentId ? computePaths(rows).get(page.parentId)! : null;
            assertSubtreeFits(rows, page.id, joinPath(parentPath, rev.title));
          }
          await tx.update(pageRevisions).set({ status: "accepted" }).where(eq(pageRevisions.id, rev.id));
          await tx
            .update(pages)
            .set({ currentRevisionId: rev.id, title: rev.title, stale: false, updatedAt: new Date() })
            .where(eq(pages.id, page.id));
          await log(tx, { actor: "human", action: "revision.accepted", pageId: page.id, details: { revisionId } });
          return { pageId: page.id };
        });
        await index(result.pageId, revisionId);
      });
    },

    /** Rejecting the last proposal of a never-accepted, childless page also removes that page. */
    async rejectRevision(revisionId) {
      return guard(async () => {
        await d().transaction(async (tx) => {
          await lockWiki(tx);
          const [rev] = await tx.select().from(pageRevisions).where(eq(pageRevisions.id, revisionId));
          if (!rev) throw new WikiError("not_found", `Revision ${revisionId} not found`);
          if (rev.status !== "proposed") throw new WikiError("invalid", `Revision is ${rev.status}, not proposed`);
          await tx.update(pageRevisions).set({ status: "rejected" }).where(eq(pageRevisions.id, rev.id));
          await log(tx, { actor: "human", action: "revision.rejected", pageId: rev.pageId, details: { revisionId } });

          const rows = await loadOutline(tx);
          const page = mustGet(rows, rev.pageId);
          const [{ pending }] = await tx
            .select({ pending: sql<number>`count(*)::int` })
            .from(pageRevisions)
            .where(and(eq(pageRevisions.pageId, page.id), eq(pageRevisions.status, "proposed")));
          if (page.currentRevisionId === null && pending === 0 && !rows.some((r) => r.parentId === page.id)) {
            const path = computePaths(rows).get(page.id);
            await tx.delete(pages).where(eq(pages.id, page.id));
            await renumber(tx, childrenOf(rows, page.parentId).filter((r) => r.id !== page.id), page.parentId);
            await log(tx, {
              actor: "human",
              action: "page.deleted",
              details: { pageId: page.id, title: page.title, path, reason: "its only proposal was rejected" },
            });
          }
        });
      });
    },

    async markStaleByFiles(repoId, paths) {
      if (paths.length === 0) return [];
      return guard(async () =>
        d().transaction(async (tx) => {
          const hits = await tx
            .selectDistinct({ pageId: pages.id, path: revisionSources.path })
            .from(pages)
            .innerJoin(revisionSources, eq(revisionSources.revisionId, pages.currentRevisionId))
            .where(and(eq(revisionSources.repoId, repoId), inArray(revisionSources.path, paths)))
            .orderBy(asc(pages.id), asc(revisionSources.path));
          const byPage = new Map<string, string[]>();
          for (const h of hits) byPage.set(h.pageId, [...(byPage.get(h.pageId) ?? []), h.path]);
          const ids = [...byPage.keys()];
          if (ids.length === 0) return [];
          await tx.update(pages).set({ stale: true }).where(inArray(pages.id, ids));
          for (const [pageId, files] of byPage) {
            await log(tx, { actor: "agent", action: "page.stale", pageId, repoId, details: { files } });
          }
          return ids;
        }),
      );
    },

    async revertToRevision(revisionId, author) {
      return guard(async () => {
        const [rev] = await d().select().from(pageRevisions).where(eq(pageRevisions.id, revisionId));
        if (!rev) throw new WikiError("not_found", `Revision ${revisionId} not found`);
        if (rev.status !== "accepted") throw new WikiError("invalid", "Only an accepted revision can be restored");
        const cites = (await citationsByRevision(d(), [rev.id])).get(rev.id) ?? [];
        // Body and citations only: restoring an old title could collide with a sibling created since.
        return updatePage(
          {
            pageId: rev.pageId,
            bodyMd: rev.bodyMd,
            reason: `Revert to revision ${rev.id.slice(0, 8)}`,
            citations: cites,
            author,
            mode: "apply",
          },
          "page.reverted",
        );
      });
    },

    async listRevisionDetails(pageId) {
      return guard(async () => {
        const [page] = await d().select({ current: pages.currentRevisionId }).from(pages).where(eq(pages.id, pageId));
        if (!page) throw new WikiError("not_found", `Page ${pageId} not found`);
        const revs = await d()
          .select()
          .from(pageRevisions)
          .where(eq(pageRevisions.pageId, pageId))
          .orderBy(desc(pageRevisions.createdAt), desc(pageRevisions.id));
        const cites = await citationsByRevision(d(), revs.map((r) => r.id));
        return revs.map((r) => ({
          ...toSummary(r),
          title: r.title,
          bodyMd: r.bodyMd,
          parentRevisionId: r.parentRevisionId,
          citations: cites.get(r.id) ?? [],
          isCurrent: r.id === page.current,
        }));
      });
    },

    async listProposals(filter = {}) {
      const rows = await loadOutline(d());
      const paths = computePaths(rows);
      const revs = await d()
        .select()
        .from(pageRevisions)
        .where(
          and(
            eq(pageRevisions.status, "proposed"),
            filter.pageId ? eq(pageRevisions.pageId, filter.pageId) : undefined,
            filter.revisionId ? eq(pageRevisions.id, filter.revisionId) : undefined,
          ),
        )
        .orderBy(asc(pageRevisions.createdAt), asc(pageRevisions.id));
      const currentIds = [...new Set(rows.map((r) => r.currentRevisionId).filter((x): x is string => !!x))];
      const currents = currentIds.length
        ? await d()
            .select({ id: pageRevisions.id, bodyMd: pageRevisions.bodyMd })
            .from(pageRevisions)
            .where(inArray(pageRevisions.id, currentIds))
        : [];
      const bodyById = new Map(currents.map((c) => [c.id, c.bodyMd]));
      const cites = await citationsByRevision(d(), revs.map((r) => r.id));
      return revs.map((r) => {
        const page = rows.find((p) => p.id === r.pageId)!;
        return {
          ...toSummary(r),
          title: r.title,
          bodyMd: r.bodyMd,
          parentRevisionId: r.parentRevisionId,
          citations: cites.get(r.id) ?? [],
          isCurrent: false,
          pagePath: paths.get(page.id)!,
          isNewPage: page.currentRevisionId === null,
          currentTitle: page.title,
          currentBodyMd: page.currentRevisionId ? (bodyById.get(page.currentRevisionId) ?? "") : "",
          outdated: r.parentRevisionId !== page.currentRevisionId,
        };
      });
    },

    async listProposalSummaries() {
      const rows = await loadOutline(d());
      const paths = computePaths(rows);
      const revs = await d()
        .select({
          id: pageRevisions.id,
          pageId: pageRevisions.pageId,
          status: pageRevisions.status,
          authorKind: pageRevisions.authorKind,
          reason: pageRevisions.reason,
          createdAt: pageRevisions.createdAt,
          title: pageRevisions.title,
          parentRevisionId: pageRevisions.parentRevisionId,
          citationCount: sql<number>`(select count(*)::int from ${revisionSources} where ${revisionSources.revisionId} = ${pageRevisions.id})`,
        })
        .from(pageRevisions)
        .where(eq(pageRevisions.status, "proposed"))
        .orderBy(asc(pageRevisions.createdAt), asc(pageRevisions.id));
      return revs.map(({ parentRevisionId, title, citationCount, ...r }) => {
        const page = rows.find((p) => p.id === r.pageId)!;
        return {
          ...r,
          createdAt: r.createdAt.toISOString(),
          title,
          citationCount,
          pagePath: paths.get(page.id)!,
          isNewPage: page.currentRevisionId === null,
          outdated: parentRevisionId !== page.currentRevisionId,
        };
      });
    },

    async countProposals() {
      const [{ n }] = await d().select({ n: sql<number>`count(*)::int` }).from(pageRevisions).where(eq(pageRevisions.status, "proposed"));
      return n;
    },

    async pagePaths() {
      return Object.fromEntries(computePaths(await loadOutline(d())));
    },

    async staleFiles(pageId) {
      return guard(async () => {
        const [page] = await d()
          .select({ stale: pages.stale, revAt: pageRevisions.createdAt })
          .from(pages)
          .leftJoin(pageRevisions, eq(pageRevisions.id, pages.currentRevisionId))
          .where(eq(pages.id, pageId));
        if (!page?.stale) return [];
        const logs = await d()
          .select({ details: wikiLog.details })
          .from(wikiLog)
          .where(
            and(
              eq(wikiLog.pageId, pageId),
              eq(wikiLog.action, "page.stale"),
              page.revAt ? gte(wikiLog.at, page.revAt) : undefined,
            ),
          );
        const files = logs.flatMap((l) => (Array.isArray(l.details?.files) ? (l.details.files as string[]) : []));
        return [...new Set(files)].sort();
      });
    },
  };
  return store;
}

/** The app's store: the shared database, and accepted revisions re-embedded by the worker. */
export const wikiStore: WikiStoreExt = createWikiStore(() => appDb(), {
  enqueueIndexPage: (job) => enqueue(QUEUES.indexPage, job),
});
