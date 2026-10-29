import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TEST_ADMIN_URL, testDbName } from "@/test/db-url";
import { createDb, type Db } from "./client";

/** Migrations up to here are the single-wiki schema an existing install has. */
const LAST_SINGLE_WIKI = "0004_project_layout";
const name = `${testDbName()}_migrate`;
const url = Object.assign(new URL(TEST_ADMIN_URL), { pathname: `/${name}` }).toString();
const admin = postgres(TEST_ADMIN_URL, { max: 1, onnotice: () => {} });
let db: Db;
let folder: string;

beforeAll(async () => {
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  folder = await mkdtemp(join(tmpdir(), "wiki-migrations-"));
  await cp("drizzle", folder, { recursive: true });
  const journalPath = join(folder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const cut = journal.entries.findIndex((e: { tag: string }) => e.tag === LAST_SINGLE_WIKI);
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));
  db = createDb(url);
  await migrate(db, { migrationsFolder: folder });
});

afterAll(async () => {
  await db?.$client.end();
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end();
  await rm(folder, { recursive: true, force: true });
});

it("moves an existing single-wiki install into a 'default' wiki, keeping its brief and layout", async () => {
  const sql = db.$client;
  await sql`insert into project_settings (id, context, layout) values (1, 'The brief.', 'repo')`;
  const [repo] = await sql`insert into repos (owner, name) values ('acme', 'api') returning id`;
  const [page] = await sql`insert into pages (title) values ('Overview') returning id`;
  await sql`insert into pages (title, parent_id) values ('Child', ${page.id})`;
  await sql`insert into chats (title) values ('a chat')`;
  await sql`insert into agent_runs (kind, model) values ('chat', 'm')`;
  await sql`insert into wiki_log (actor, action, repo_id) values ('agent', 'repo.synced', ${repo.id})`;

  await migrate(db, { migrationsFolder: "drizzle" });

  const wikis = await sql`select id, slug, name, context, layout from wikis`;
  expect(wikis).toEqual([expect.objectContaining({ slug: "default", name: "Default", context: "The brief.", layout: "repo" })]);
  for (const table of ["repos", "pages", "chats", "agent_runs", "wiki_log"]) {
    const rows = await sql`select wiki_id from ${sql(table)}`;
    expect(rows.length, table).toBeGreaterThan(0);
    expect(rows.every((r) => r.wiki_id === wikis[0].id), table).toBe(true);
  }
  expect((await sql`select to_regclass('project_settings') as t`)[0].t).toBeNull();
});
