CREATE TYPE "public"."agent_run_kind" AS ENUM('chat', 'author', 'lint');--> statement-breakpoint
CREATE TYPE "public"."author_kind" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TYPE "public"."chunk_kind" AS ENUM('code', 'doc');--> statement-breakpoint
CREATE TYPE "public"."repo_status" AS ENUM('idle', 'queued', 'syncing', 'error');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('proposed', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "agent_run_kind" NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" "chunk_kind" NOT NULL,
	"lang" text,
	"symbol" text,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"content" text NOT NULL,
	"embedded_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"commit_sha" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(path, '') || ' ' || coalesce(symbol, '') || ' ' || content)) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_repo_id_path_content_hash_unique" UNIQUE("repo_id","path","content_hash")
);
--> statement-breakpoint
CREATE TABLE "page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"author_kind" "author_kind" NOT NULL,
	"agent_run_id" uuid,
	"reason" text,
	"status" "revision_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"current_revision_id" uuid,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_parent_id_title_unique" UNIQUE NULLS NOT DISTINCT("parent_id","title")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text,
	"desired_sha" text,
	"synced_sha" text,
	"status" "repo_status" DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"last_polled_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repos_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "revision_sources" (
	"revision_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"commit_sha" text NOT NULL,
	"start_line" integer,
	"end_line" integer
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_hash" text NOT NULL,
	"lang" text,
	"indexed_sha" text NOT NULL,
	CONSTRAINT "source_files_repo_id_path_pk" PRIMARY KEY("repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"heading_path" text,
	"content" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading_path, '') || ' ' || content)) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" "author_kind" NOT NULL,
	"action" text NOT NULL,
	"page_id" uuid,
	"repo_id" uuid,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_parent_revision_id_page_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."page_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_current_revision_id_page_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."page_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_sources" ADD CONSTRAINT "revision_sources_revision_id_page_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."page_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_sources" ADD CONSTRAINT "revision_sources_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_chunks" ADD CONSTRAINT "wiki_chunks_revision_id_page_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."page_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_chat_id_created_at_index" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chunks_repo_path_idx" ON "chunks" USING btree ("repo_id","path");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "page_revisions_page_id_status_index" ON "page_revisions" USING btree ("page_id","status");--> statement-breakpoint
CREATE INDEX "pages_parent_id_index" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "revision_sources_repo_id_path_index" ON "revision_sources" USING btree ("repo_id","path");--> statement-breakpoint
CREATE INDEX "revision_sources_revision_id_index" ON "revision_sources" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "wiki_chunks_page_id_index" ON "wiki_chunks" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "wiki_chunks_embedding_idx" ON "wiki_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "wiki_chunks_tsv_idx" ON "wiki_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "wiki_log_at_index" ON "wiki_log" USING btree ("at");