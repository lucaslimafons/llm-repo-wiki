import { db } from "@/db/client";
import { prodRepoDeps } from "@/ingest/deps";
import { addRepo } from "@/ingest/repos";
import { getBoss } from "@/jobs/queue";

/** `pnpm repo:add owner/name`: the same validated path as the UI's add form. The worker syncs it. */
const result = await addRepo(prodRepoDeps(), process.argv[2]);
if (result.ok) console.log(`added ${process.argv[2]} (${result.data.id}); the worker will sync it`);
else console.error(result.error);
await (await getBoss()).stop({ graceful: true });
await db().$client.end();
process.exit(result.ok ? 0 : 1);
