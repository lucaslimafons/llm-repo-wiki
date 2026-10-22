import { parseArgs } from "node:util";
import { db } from "@/db/client";
import { exportWiki } from "./export";

/** pnpm tsx --env-file=.env.local src/export/cli.ts --out <dir> [--force] */
async function main() {
  const { values } = parseArgs({
    options: { out: { type: "string" }, force: { type: "boolean", default: false } },
  });
  if (!values.out) throw new Error("usage: src/export/cli.ts --out <dir> [--force]");
  const { files } = await exportWiki(db(), values.out, { force: values.force });
  console.log(`[export] wrote ${files} files to ${values.out}`);
  await db().$client.end();
}

main().catch((err) => {
  console.error("[export]", err instanceof Error ? err.message : err);
  process.exit(1);
});
