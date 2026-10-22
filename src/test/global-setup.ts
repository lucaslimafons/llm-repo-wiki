import postgres from "postgres";
import { runMigrations } from "@/db/migrate";
import { testDatabaseUrl, TEST_ADMIN_URL, testDbName } from "./db-url";

/** Creates (once) and migrates this checkout's test database. */
export default async function setup() {
  const admin = postgres(TEST_ADMIN_URL, { max: 1, onnotice: () => {} });
  const name = testDbName();
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();
  await runMigrations(testDatabaseUrl());
  process.env.DATABASE_URL = testDatabaseUrl();
}
