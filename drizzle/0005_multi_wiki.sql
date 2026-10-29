CREATE TABLE "wikis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"layout" text DEFAULT 'topic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wikis_slug_unique" UNIQUE("slug"),
	CONSTRAINT "wikis_layout" CHECK ("wikis"."layout" in ('topic', 'repo')),
	CONSTRAINT "wikis_slug_format" CHECK ("wikis"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_parent_id_title_unique";--> statement-breakpoint
DROP INDEX "chats_updated_at_index";--> statement-breakpoint
DROP INDEX "wiki_log_at_index";--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "wiki_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "wiki_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "wiki_id" uuid;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "wiki_id" uuid;--> statement-breakpoint
ALTER TABLE "wiki_log" ADD COLUMN "wiki_id" uuid;--> statement-breakpoint
-- Hand-written: everything that exists today becomes the default wiki, keeping the old brief and layout.
INSERT INTO "wikis" ("slug", "name", "context", "layout")
SELECT 'default', 'Default', coalesce((SELECT "context" FROM "project_settings" WHERE "id" = 1), ''),
  coalesce((SELECT "layout" FROM "project_settings" WHERE "id" = 1), 'topic')
WHERE EXISTS (SELECT 1 FROM "repos") OR EXISTS (SELECT 1 FROM "pages") OR EXISTS (SELECT 1 FROM "chats")
  OR EXISTS (SELECT 1 FROM "agent_runs") OR EXISTS (SELECT 1 FROM "wiki_log") OR EXISTS (SELECT 1 FROM "project_settings");--> statement-breakpoint
UPDATE "agent_runs" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "slug" = 'default');--> statement-breakpoint
UPDATE "chats" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "slug" = 'default');--> statement-breakpoint
UPDATE "pages" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "slug" = 'default');--> statement-breakpoint
UPDATE "repos" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "slug" = 'default');--> statement-breakpoint
UPDATE "wiki_log" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "slug" = 'default');--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_log" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_wiki_id_updated_at_index" ON "chats" USING btree ("wiki_id","updated_at");--> statement-breakpoint
CREATE INDEX "repos_wiki_id_index" ON "repos" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "wiki_log_wiki_id_at_index" ON "wiki_log" USING btree ("wiki_id","at");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_wiki_id_parent_id_title_unique" UNIQUE NULLS NOT DISTINCT("wiki_id","parent_id","title");