import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/** text-embedding-3-small. A different model with different dims needs a migration + reindex. */
export const EMBEDDING_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── Raw layer: repos and their chunks (immutable per commit) ────────────────

export const repoStatus = pgEnum("repo_status", ["idle", "queued", "syncing", "error"]);

export const repos = pgTable(
  "repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch"),
    /** Latest head seen (poll, webhook or manual sync). The sync job reads this when it starts. */
    desiredSha: text("desired_sha"),
    /** Commit whose content is fully indexed. Advanced only after every file commits. */
    syncedSha: text("synced_sha"),
    status: repoStatus("status").notNull().default("idle"),
    lastError: text("last_error"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /** The owner's one-line description of this repo's part in the project, e.g. "mobile app". */
    role: text("role"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.owner, t.name)],
);

export const sourceFiles = pgTable(
  "source_files",
  {
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    lang: text("lang"),
    indexedSha: text("indexed_sha").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.path] })],
);

export const chunkKind = pgEnum("chunk_kind", ["code", "doc"]);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: chunkKind("kind").notNull(),
    lang: text("lang"),
    /** Heading path for docs ("Setup > Docker"), scope chain for code ("Foo.bar"). */
    symbol: text("symbol"),
    /** 1-based, inclusive. code-chunk reports 0-based lines: convert at the boundary. */
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    /** What was embedded: content plus its file/scope header. */
    embeddedText: text("embedded_text").notNull(),
    contentHash: text("content_hash").notNull(),
    commitSha: text("commit_sha").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce(path, '') || ' ' || coalesce(symbol, '') || ' ' || content)`,
      ),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.repoId, t.path, t.contentHash),
    index("chunks_repo_path_idx").on(t.repoId, t.path),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_tsv_idx").using("gin", t.tsv),
  ],
);

// ── Compiled layer: the wiki (a page tree: a folder is a page with children) ──

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, { onDelete: "restrict" }),
    /** Display title. Slugged to a filename only on export. */
    title: text("title").notNull(),
    sortKey: integer("sort_key").notNull().default(0),
    currentRevisionId: uuid("current_revision_id").references(
      (): AnyPgColumn => pageRevisions.id,
    ),
    /** Set when a file this page cites changed since the page was written. */
    stale: boolean("stale").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.parentId, t.title).nullsNotDistinct(), index().on(t.parentId)],
);

export const authorKind = pgEnum("author_kind", ["agent", "human"]);
export const revisionStatus = pgEnum("revision_status", ["proposed", "accepted", "rejected"]);

export const pageRevisions = pgTable(
  "page_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
    parentRevisionId: uuid("parent_revision_id").references((): AnyPgColumn => pageRevisions.id),
    title: text("title").notNull(),
    /** Markdown. Internal links are stored as `wiki:<page uuid>` so moves never rewrite bodies. */
    bodyMd: text("body_md").notNull(),
    authorKind: authorKind("author_kind").notNull(),
    agentRunId: uuid("agent_run_id").references((): AnyPgColumn => agentRuns.id),
    reason: text("reason"),
    status: revisionStatus("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.pageId, t.status)],
);

/** Every claim's citation. Also the map from a changed file to the pages that went stale. */
export const revisionSources = pgTable(
  "revision_sources",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => pageRevisions.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    commitSha: text("commit_sha").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
  },
  (t) => [index().on(t.repoId, t.path), index().on(t.revisionId)],
);

/** Accepted wiki revisions, chunked and embedded so search can scope to the compiled layer. */
export const wikiChunks = pgTable(
  "wiki_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => pageRevisions.id, { onDelete: "cascade" }),
    headingPath: text("heading_path"),
    content: text("content").notNull(),
    embeddingModel: text("embedding_model").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce(heading_path, '') || ' ' || content)`,
      ),
  },
  (t) => [
    index().on(t.pageId),
    index("wiki_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("wiki_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

// ── Operations: Karpathy's log.md, agent runs, chats, webhook dedupe ────────

export const agentRunKind = pgEnum("agent_run_kind", ["chat", "author", "lint"]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: agentRunKind("kind").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("running"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** From OpenRouter's usage accounting (providerMetadata.openrouter.usage.cost). */
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Append-only. Never update or delete rows here. */
export const wikiLog = pgTable(
  "wiki_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: authorKind("actor").notNull(),
    action: text("action").notNull(),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "set null" }),
    repoId: uuid("repo_id").references(() => repos.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [index().on(t.at)],
);

/** A chat session. Reopening one reloads its full history server-side into the agent. */
export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title"),
    /** Rolling summary of messages older than the context window keeps verbatim. */
    summary: text("summary"),
    /** Last message id folded into `summary`; later messages are sent to the model verbatim. */
    summarizedThroughMessageId: text("summarized_through_message_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.updatedAt)],
);

/** One AI SDK UIMessage per row, stored whole (tool calls and source parts included) and re-validated on load. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    message: jsonb("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.chatId, t.createdAt)],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row: the owner's brief about the project the repos make up, read by the author and chat agents. */
export const projectSettings = pgTable(
  "project_settings",
  {
    id: smallint("id").primaryKey().default(1),
    context: text("context").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("project_settings_single_row", sql`${t.id} = 1`)],
);
