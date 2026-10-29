import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { wikis } from "@/db/schema";
import { testDatabaseUrl } from "./db-url";

let cached: Db | undefined;

export function testDb(): Db {
  cached ??= createDb(testDatabaseUrl());
  return cached;
}

/** Wipes every app table (not pg-boss's schema). Call in beforeEach. */
export async function resetDb() {
  await testDb().execute(sql`
    truncate repos, source_files, chunks, pages, page_revisions, revision_sources,
      wiki_chunks, agent_runs, wiki_log, chats, chat_messages, webhook_deliveries, wikis
    restart identity cascade`);
}

/** A wiki to put fixtures in: every repo, page, chat, run and log row needs one. Returns its id. */
export async function createTestWiki(slug = "main", name = slug): Promise<string> {
  const [row] = await testDb().insert(wikis).values({ slug, name }).returning({ id: wikis.id });
  return row.id;
}

/** A deterministic unit vector, so vector tests never call a real embedding API. */
export function fakeEmbedding(seed: number, dims = 1536): number[] {
  const v = Array.from({ length: dims }, (_, i) => Math.sin(seed * 997 + i * 13));
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}
