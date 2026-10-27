CREATE TABLE "project_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_settings_single_row" CHECK ("project_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "role" text;