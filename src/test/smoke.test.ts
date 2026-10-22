import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { testDb } from "./db";

describe("test database", () => {
  it("has pgvector and the schema applied", async () => {
    const rows = await testDb().execute(sql`select extversion from pg_extension where extname = 'vector'`);
    expect(rows[0]?.extversion).toBe("0.8.7");
  });
});
