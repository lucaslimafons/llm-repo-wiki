import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema, casing: "snake_case" });
}

let cached: Db | undefined;

export function db(): Db {
  cached ??= createDb(env().DATABASE_URL);
  return cached;
}
