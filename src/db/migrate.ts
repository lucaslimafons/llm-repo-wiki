import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

/** Applies ./drizzle migrations. Used by `pnpm db:migrate` and the test global setup. */
export async function runMigrations(url: string) {
  const db = createDb(url);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.$client.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  console.log("migrations applied");
}
