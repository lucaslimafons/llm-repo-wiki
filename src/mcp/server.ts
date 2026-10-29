import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { prodRepoDeps } from "@/ingest/deps";
import { syncRepoNow } from "@/ingest/repos";
import { getBoss } from "@/jobs/queue";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";
import { resolveWiki } from "@/wikis/wikis";
import {
  listPagesTool,
  readPageInputSchema,
  readPageTool,
  repoStatusTool,
  searchInputSchema,
  searchTool,
  syncRepoInputSchema,
  syncRepoTool,
  type McpDeps,
} from "./handlers";
import { SERVER_INSTRUCTIONS } from "./instructions";

// 🔴 stdout carries the protocol: one stray console.log from any module corrupts the stream.
console.log = console.info = console.debug = console.error;

// One server per wiki: `pnpm mcp --wiki <slug>`, optional while only one wiki exists.
const { values: args } = parseArgs({ options: { wiki: { type: "string" } }, strict: false });
const wiki = await resolveWiki(db(), typeof args.wiki === "string" ? args.wiki : undefined).catch(async (err: Error) => {
  console.error(`[mcp] ${err.message}`);
  await db().$client.end({ timeout: 2 }).catch(() => {});
  process.exit(1);
});

let queueStarted = false;
const profile = env().MCP_PROFILE;
const deps: McpDeps = {
  profile,
  db: db(),
  wikiId: wiki.id,
  store: wikiStore(wiki.id),
  search: (input) => searchKnowledge({ ...input, wikiId: wiki.id }),
  syncRepo: (id) => {
    queueStarted = true;
    return syncRepoNow(prodRepoDeps(), wiki.id, id);
  },
};

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });
async function run(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (err) {
    return { ...text(`Error: ${err instanceof Error ? err.message : String(err)}`), isError: true };
  }
}
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function createServer() {
  const server = new McpServer({ name: "llm-repo-wiki", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: `${SERVER_INSTRUCTIONS}\n\nThis server answers from one wiki, "${wiki.name}", and only its repositories.` });
  server.registerTool(
    "search_knowledge",
    {
      title: "Search code and wiki",
      description:
        "Search code, docs and wiki pages across every indexed repository at once (hybrid full-text + semantic search). Returns ranked snippets with repo/path#lines@sha, a GitHub permalink, the wiki pages that cite each file, and how fresh the index is.",
      inputSchema: searchInputSchema,
      annotations: READ_ONLY,
      // Loaded at session start instead of via a tool-search turn (measured on every run otherwise).
      ...(profile === "compact" ? { _meta: { "anthropic/alwaysLoad": true } } : {}),
    },
    (input) => run(() => searchTool(deps, input)),
  );
  server.registerTool(
    "read_page",
    {
      title: "Read a wiki page",
      description: "Read one wiki page in full, with its citations as GitHub permalinks. Pages not yet reviewed are returned labelled as unreviewed proposals.",
      inputSchema: readPageInputSchema,
      annotations: READ_ONLY,
    },
    (input) => run(() => readPageTool(deps, input)),
  );
  server.registerTool(
    "list_pages",
    { title: "List wiki pages", description: "The wiki's page tree (paths for read_page), with stale and pending-proposal markers.", annotations: READ_ONLY },
    () => run(() => listPagesTool(deps)),
  );
  server.registerTool(
    "repo_status",
    {
      title: "Index freshness",
      description: "Per indexed repository: the commit that is indexed vs. the newest head seen, sync and authoring state, and proposals waiting for review.",
      annotations: READ_ONLY,
    },
    () => run(() => repoStatusTool(deps)),
  );
  server.registerTool(
    "sync_repo",
    {
      title: "Re-index a repository",
      description: "Queue a re-index of one repository at its latest commit (same as the Sync button). Only changed files are re-embedded; needs `pnpm worker` running.",
      inputSchema: syncRepoInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => run(() => syncRepoTool(deps, input)),
  );
  return server;
}

const handle = serveStdio(createServer, { onerror: (err) => console.error("[mcp]", err.message) });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await handle.close().catch(() => {});
  if (queueStarted) await (await getBoss()).stop({ graceful: true }).catch(() => {});
  await db().$client.end({ timeout: 2 }).catch(() => {});
  process.exit(0);
}
// The client ends the session by closing stdin; the DB pool would otherwise keep the process alive.
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
