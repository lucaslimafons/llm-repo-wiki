import { parseArgs } from "node:util";
import { db } from "@/db/client";
import { prodRepoDeps } from "@/ingest/deps";
import { addRepo } from "@/ingest/repos";
import { getBoss } from "@/jobs/queue";
import { resolveWiki } from "@/wikis/wikis";

/** `pnpm repo:add owner/name [--wiki <slug>]`: the same validated path as the UI's add form. The worker syncs it. */
const { values, positionals } = parseArgs({ options: { wiki: { type: "string" } }, allowPositionals: true });
const wiki = await resolveWiki(db(), values.wiki);
const result = await addRepo(prodRepoDeps(), wiki.id, positionals[0]);
if (result.ok) console.log(`added ${positionals[0]} to "${wiki.name}" (${result.data.id}); the worker will sync it`);
else console.error(result.error);
await (await getBoss()).stop({ graceful: true });
await db().$client.end();
process.exit(result.ok ? 0 : 1);
