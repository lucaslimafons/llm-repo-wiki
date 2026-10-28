/**
 * Talks to `pnpm mcp` over real stdio, as Claude Code would: lists the tools, then calls the
 * read-only ones. `pnpm mcp:smoke "a question"` checks a setup before registering the server.
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const query = process.argv[2] ?? "how are repositories synced";
const client = new Client({ name: "mcp-smoke", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "pnpm", args: ["--silent", "mcp"], cwd: process.cwd(), stderr: "inherit" }));

const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);
for (const [name, args] of [
  ["repo_status", {}],
  ["list_pages", {}],
  ["search_knowledge", { query, limit: 3 }],
] as const) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  console.log(`\n=== ${name}${result.isError ? " (error)" : ""} · ${text.length} chars\n${text.slice(0, 1_800)}${text.length > 1_800 ? "\n…" : ""}`);
}
await client.close();
