import { describe, expect, it } from "vitest";
import { parse, recall, summarize } from "./bench-mcp";

const meta = { id: "q", arm: "mcp" as const, run: 1, ms: 12_000, expect: ["acme/api:src/quota.ts", "acme/app:src/useQuota.ts"] };
const stream = [
  JSON.stringify({ type: "system", subtype: "init", mcp_servers: [{ name: "llm-repo-wiki", status: "connected" }] }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__llm-repo-wiki__search_knowledge" }, { type: "text" }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
  "not json",
  JSON.stringify({
    type: "result",
    result: "The quota lives in src/quota.ts.",
    num_turns: 3,
    total_cost_usd: 0.02,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
  }),
].join("\n");

describe("bench-mcp", () => {
  it("reads tool calls, MCP status and usage from Claude Code's stream-json", () => {
    const r = parse(stream, meta);
    expect(r).toMatchObject({ ok: true, tokens: 1350, turns: 3, costUsd: 0.02, mcpConnected: true, recall: 0.5 });
    expect(r.toolCalls).toEqual({ "mcp__llm-repo-wiki__search_knowledge": 1, Read: 1 });
  });

  it("marks a run without a result event as failed", () => {
    expect(parse("", meta)).toMatchObject({ ok: false, error: "no result event" });
  });

  it("scores recall on the path, case-insensitively", () => {
    expect(recall("see SRC/QUOTA.TS", ["acme/api:src/quota.ts"])).toBe(1);
  });

  it("applies the pre-registered bar", () => {
    const grep = { ...parse(stream, { ...meta, arm: "grep" }), tokens: 1000, recall: 1 };
    const cheap = { ...parse(stream, meta), tokens: 600, recall: 1 };
    const pricey = { ...cheap, tokens: 900 };
    expect(summarize([grep, cheap])).toContain("PASSES the bar");
    expect(summarize([grep, pricey])).toContain("does NOT pass the bar");
  });
});
