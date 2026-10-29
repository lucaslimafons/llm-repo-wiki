import { parseArgs } from "node:util";
import { db } from "@/db/client";
import { resolveWiki } from "@/wikis/wikis";
import { exportWiki } from "./export";

/** pnpm tsx --env-file=.env.local src/export/cli.ts --out <dir> [--wiki <slug>] [--force] */
async function main() {
  const { values } = parseArgs({
    options: { out: { type: "string" }, wiki: { type: "string" }, force: { type: "boolean", default: false } },
  });
  if (!values.out) throw new Error("usage: src/export/cli.ts --out <dir> [--wiki <slug>] [--force]");
  const wiki = await resolveWiki(db(), values.wiki);
  const { files } = await exportWiki(db(), wiki.id, values.out, { force: values.force });
  console.log(`[export] wrote ${files} files of "${wiki.name}" to ${values.out}`);
  await db().$client.end();
}

main().catch((err) => {
  console.error("[export]", err instanceof Error ? err.message : err);
  process.exit(1);
});
