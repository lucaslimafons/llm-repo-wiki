/**
 * The seams between the three build tracks (ingest/search, wiki, agent).
 * Changing a type here is a cross-track change: update every implementer in the same commit.
 */

// ── Search (implemented in src/search, consumed by the agent) ───────────────

export type SearchScope = "source" | "wiki" | "all";

export type SearchInput = {
  query: string;
  scope: SearchScope;
  /** "owner/name". Omit to search every repo. */
  repo?: string;
  limit?: number;
};

export type SourceHit = {
  kind: "source";
  chunkId: string;
  repo: string;
  path: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  commitSha: string;
  symbol: string | null;
  content: string;
  score: number;
};

export type WikiHit = {
  kind: "wiki";
  pageId: string;
  /** Display path, e.g. "Architecture/Ingestion". */
  pagePath: string;
  headingPath: string | null;
  content: string;
  score: number;
};

export type SearchHit = SourceHit | WikiHit;

// ── Wiki (implemented in src/wiki, consumed by the agent and the UI) ────────

export type Author = { kind: "agent"; agentRunId: string } | { kind: "human" };

export type Citation = {
  repo: string;
  path: string;
  commitSha: string;
  startLine?: number;
  endLine?: number;
};

export type TreeNode = {
  id: string;
  title: string;
  /** "Parent/Child" display path. */
  path: string;
  sortKey: number;
  stale: boolean;
  hasPendingProposal: boolean;
  children: TreeNode[];
};

export type PageView = {
  id: string;
  title: string;
  path: string;
  parentId: string | null;
  stale: boolean;
  /** null for a page that exists only as an unaccepted proposal. */
  revisionId: string | null;
  bodyMd: string;
  citations: Citation[];
  updatedAt: string;
};

export type RevisionSummary = {
  id: string;
  pageId: string;
  status: "proposed" | "accepted" | "rejected";
  authorKind: "agent" | "human";
  reason: string | null;
  createdAt: string;
};

export type WriteMode =
  /** Chat with a human present: the write lands as an accepted revision (revertible). */
  | "apply"
  /** Background agent: the write lands as a proposal awaiting review. */
  | "propose";

export type CreatePageInput = {
  parentId: string | null;
  title: string;
  bodyMd: string;
  reason: string;
  citations: Citation[];
  author: Author;
  mode: WriteMode;
};

export type UpdatePageInput = {
  pageId: string;
  bodyMd: string;
  title?: string;
  /** The revision the writer read. If the page moved on since, the write is refused as a conflict. */
  baseRevisionId?: string | null;
  reason: string;
  citations: Citation[];
  author: Author;
  mode: WriteMode;
};

export type MovePageInput = {
  pageId: string;
  newParentId: string | null;
  /** Position among the new siblings; omitted appends at the end. */
  index?: number;
  author: Author;
};

export type WikiStore = {
  listTree(): Promise<TreeNode[]>;
  getPage(ref: { id: string } | { path: string }): Promise<PageView | null>;
  createPage(input: CreatePageInput): Promise<{ pageId: string; revisionId: string }>;
  updatePage(input: UpdatePageInput): Promise<{ revisionId: string }>;
  movePage(input: MovePageInput): Promise<void>;
  /** Refuses a page that still has children. */
  deletePage(input: { pageId: string; author: Author }): Promise<void>;
  listRevisions(pageId: string): Promise<RevisionSummary[]>;
  acceptRevision(revisionId: string): Promise<void>;
  rejectRevision(revisionId: string): Promise<void>;
  /** Marks pages citing any of these files as stale; returns their ids. */
  markStaleByFiles(repoId: string, paths: string[]): Promise<string[]>;
};

// ── Jobs (pg-boss queue names and payloads) ──────────────────────────────────

export const QUEUES = {
  /** Poll every repo's default branch head; enqueue sync-repo when it moved. */
  pollRepos: "poll-repos",
  /** One per repo (stately + singletonKey = repo id). Reads repos.desired_sha at start. */
  syncRepo: "sync-repo",
  /** After a sync: (re)write the pages affected by the changed files. */
  authorWiki: "author-wiki",
  /** Re-embed an accepted page revision into wiki_chunks. */
  indexPage: "index-page",
  /** Scheduled health check: orphans, dead links, stale pages, uncited claims. */
  lintWiki: "lint-wiki",
} as const;

export type JobPayloads = {
  [QUEUES.pollRepos]: Record<string, never>;
  [QUEUES.syncRepo]: { repoId: string };
  [QUEUES.authorWiki]: {
    repoId: string;
    fromSha: string | null;
    toSha: string;
    changedPaths: string[];
  };
  [QUEUES.indexPage]: { pageId: string; revisionId: string };
  [QUEUES.lintWiki]: Record<string, never>;
};
