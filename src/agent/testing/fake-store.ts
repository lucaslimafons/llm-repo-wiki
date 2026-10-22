import { randomUUID } from "node:crypto";
import type {
  Author,
  Citation,
  PageView,
  RevisionSummary,
  TreeNode,
  WikiStore,
} from "@/core/contracts";

type Revision = RevisionSummary & { bodyMd: string; title: string; citations: Citation[]; agentRunId: string | null };
type Page = { id: string; parentId: string | null; title: string; sortKey: number; stale: boolean; currentRevisionId: string | null };

/** In-memory WikiStore for agent tests (Track B owns the real one). Records every call. */
export function createFakeStore() {
  const pages = new Map<string, Page>();
  const revisions: Revision[] = [];
  const calls: { method: string; input: unknown }[] = [];

  const pathOf = (p: Page): string => (p.parentId ? `${pathOf(pages.get(p.parentId)!)}/${p.title}` : p.title);
  const children = (parentId: string | null) =>
    [...pages.values()].filter((p) => p.parentId === parentId).sort((a, b) => a.sortKey - b.sortKey);
  const view = (p: Page): PageView => {
    const rev = revisions.find((r) => r.id === p.currentRevisionId)
      ?? revisions.findLast((r) => r.pageId === p.id && r.status === "proposed");
    return {
      id: p.id,
      title: p.title,
      path: pathOf(p),
      parentId: p.parentId,
      stale: p.stale,
      revisionId: p.currentRevisionId,
      bodyMd: rev?.bodyMd ?? "",
      citations: rev?.citations ?? [],
      updatedAt: new Date().toISOString(),
    };
  };
  const toNode = (p: Page): TreeNode => ({
    id: p.id,
    title: p.title,
    path: pathOf(p),
    sortKey: p.sortKey,
    stale: p.stale,
    hasPendingProposal: revisions.some((r) => r.pageId === p.id && r.status === "proposed"),
    children: children(p.id).map(toNode),
  });
  const addRevision = (pageId: string, input: { title: string; bodyMd: string; citations: Citation[]; reason: string; author: Author; mode: string }) => {
    const rev: Revision = {
      id: randomUUID(),
      pageId,
      status: input.mode === "apply" ? "accepted" : "proposed",
      authorKind: input.author.kind,
      agentRunId: input.author.kind === "agent" ? input.author.agentRunId : null,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      bodyMd: input.bodyMd,
      title: input.title,
      citations: input.citations,
    };
    revisions.push(rev);
    if (rev.status === "accepted") pages.get(pageId)!.currentRevisionId = rev.id;
    return rev;
  };

  const store: WikiStore = {
    async listTree() {
      calls.push({ method: "listTree", input: null });
      return children(null).map(toNode);
    },
    async getPage(ref) {
      calls.push({ method: "getPage", input: ref });
      const page = "id" in ref ? pages.get(ref.id) : [...pages.values()].find((p) => pathOf(p) === ref.path);
      return page ? view(page) : null;
    },
    async createPage(input) {
      calls.push({ method: "createPage", input });
      if (children(input.parentId).some((p) => p.title === input.title)) throw new Error("duplicate title");
      const page: Page = { id: randomUUID(), parentId: input.parentId, title: input.title, sortKey: children(input.parentId).length, stale: false, currentRevisionId: null };
      pages.set(page.id, page);
      const rev = addRevision(page.id, input);
      return { pageId: page.id, revisionId: rev.id };
    },
    async updatePage(input) {
      calls.push({ method: "updatePage", input });
      const page = pages.get(input.pageId);
      if (!page) throw new Error("no such page");
      if (input.mode === "apply") page.stale = false;
      return { revisionId: addRevision(page.id, { ...input, title: input.title ?? page.title }).id };
    },
    async movePage(input) {
      calls.push({ method: "movePage", input });
      const page = pages.get(input.pageId)!;
      page.parentId = input.newParentId;
      page.sortKey = input.index ?? children(input.newParentId).length;
    },
    async deletePage(input) {
      calls.push({ method: "deletePage", input });
      if (children(input.pageId).length > 0) throw new Error("page has children");
      pages.delete(input.pageId);
    },
    async listRevisions(pageId) {
      return revisions.filter((r) => r.pageId === pageId).map(({ id, pageId: p, status, authorKind, reason, createdAt }) => ({ id, pageId: p, status, authorKind, reason, createdAt }));
    },
    async acceptRevision(id) {
      const rev = revisions.find((r) => r.id === id)!;
      rev.status = "accepted";
      pages.get(rev.pageId)!.currentRevisionId = rev.id;
    },
    async rejectRevision(id) {
      revisions.find((r) => r.id === id)!.status = "rejected";
    },
    async markStaleByFiles() {
      return [];
    },
  };

  return {
    store,
    calls,
    revisions,
    writes: () => calls.filter((c) => ["createPage", "updatePage", "movePage", "deletePage"].includes(c.method)),
    /** Seed an accepted page directly (no call recorded). */
    seed(path: string, bodyMd = `# ${path}`, citations: Citation[] = [], opts: { stale?: boolean } = {}) {
      let parentId: string | null = null;
      for (const title of path.split("/")) {
        let page: Page | undefined = children(parentId).find((p) => p.title === title);
        if (!page) {
          page = { id: randomUUID(), parentId, title, sortKey: children(parentId).length, stale: false, currentRevisionId: null };
          pages.set(page.id, page);
          addRevision(page.id, { title, bodyMd: `# ${title}`, citations: [], reason: "seed", author: { kind: "human" }, mode: "apply" });
        }
        parentId = page.id;
      }
      const page = pages.get(parentId!)!;
      page.stale = opts.stale ?? false;
      addRevision(page.id, { title: page.title, bodyMd, citations, reason: "seed", author: { kind: "human" }, mode: "apply" });
      return page.id;
    },
  };
}

export type FakeStore = ReturnType<typeof createFakeStore>;
