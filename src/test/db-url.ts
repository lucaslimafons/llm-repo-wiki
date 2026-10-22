export const TEST_ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://wiki:wiki@127.0.0.1:5433/wiki";

/** Parallel worktrees set TEST_DB_NAME so their suites never truncate each other's data. */
export function testDbName() {
  const name = process.env.TEST_DB_NAME ?? "wiki_test";
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`invalid TEST_DB_NAME: ${name}`);
  return name;
}

export function testDatabaseUrl() {
  const url = new URL(TEST_ADMIN_URL);
  url.pathname = `/${testDbName()}`;
  return url.toString();
}
