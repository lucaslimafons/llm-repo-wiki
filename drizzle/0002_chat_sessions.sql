ALTER TABLE "chats" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "summarized_through_message_id" text;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "chats_updated_at_index" ON "chats" USING btree ("updated_at");