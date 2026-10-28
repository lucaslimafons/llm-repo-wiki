/**
 * Does the MCP server save Claude Code tokens and time vs. grep, without losing accuracy?
 * Runs each question through `claude -p` twice per run, identical except one arm also has the
 * wiki's MCP tools. Copy eval/mcp-bench.example.json to eval/mcp-bench.local.json (gitignored:
 * questions and transcripts quote private repos). Uses your Claude Code login, not an API key.
 *
 *   pnpm bench:mcp [--config path] [--runs n] [--only id,id]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  workdir: z.string().min(1),
  addDirs: z.array(z.string().min(1)).default([]),
  runs: z.number().int().min(1).max(10).default(3),
  model: z.string().optional(),
  questions: z.array(z.object({ id: z.string(), question: z.string(), expect: z.array(z.string().regex(/^[^:]+:.+$/, "repo:path")) })).min(1),
});
type Config = z.infer<typeof configSchema>;
type Arm = "grep" | "mcp";

/** Pre-registered bar (issue #13): ship it as the recommended setup only if this holds. */
const BAR = { maxTokenRatio: 0.7, maxRecallDrop: 0.05 };
// Read, Grep and Glob are NOT listed: an explicit allow grants them everywhere, and a run then
// wanders into sibling clones. Left to the default, they work only inside workdir + addDirs.
const MCP_TOOLS = ["search_knowledge", "read_page", "list_pages", "repo_status"].map((t) => `mcp__llm-repo-wiki__${t}`);
// Edits, shell, web and subagents would make the arms incomparable; sync_repo stays out of a measurement.
const DENIED = ["Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Agent", "Task", "mcp__llm-repo-wiki__sync_repo"];

type RunResult = {
  id: string;
  arm: Arm;
  run: number;
  ok: boolean;
  error?: string;
  tokens: number;
  usage: Record<string, number>;
  costUsd: number;
  turns: number;
  ms: number;
  toolCalls: Record<string, number>;
  mcpConnected: boolean;
  recall: number;
  answer: string;
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const repoRoot = process.cwd();
  const config = configSchema.parse(JSON.parse(await readFile(resolve(arg("config") ?? "eval/mcp-bench.local.json"), "utf8")));
  const runs = Number(arg("runs") ?? config.runs);
  const only = arg("only")?.split(",");
  const questions = config.questions.filter((q) => !only || only.includes(q.id));

  const outDir = join(repoRoot, "eval/results/mcp", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outDir, { recursive: true });
  const mcpConfigs: Record<Arm, string> = { grep: join(outDir, "mcp-none.json"), mcp: join(outDir, "mcp-wiki.json") };
  await writeFile(mcpConfigs.grep, JSON.stringify({ mcpServers: {} }));
  await writeFile(
    mcpConfigs.mcp,
    JSON.stringify({ mcpServers: { "llm-repo-wiki": { type: "stdio", command: "pnpm", args: ["--silent", "--dir", repoRoot, "mcp"] } } }),
  );

  const results: RunResult[] = [];
  for (const q of questions) {
    for (let run = 1; run <= runs; run++) {
      // Alternate which arm goes first, so warm caches don't always favour the same one.
      const arms: Arm[] = run % 2 ? ["grep", "mcp"] : ["mcp", "grep"];
      for (const arm of arms) {
        const r = await runOnce(config, q, arm, run, mcpConfigs[arm], outDir);
        results.push(r);
        console.error(`${q.id} ${arm} #${run}: ${r.ok ? `${r.tokens} tokens, ${r.turns} turns, ${(r.ms / 1000).toFixed(0)}s, recall ${r.recall.toFixed(2)}` : `FAILED ${r.error}`}`);
      }
    }
  }
  await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(summarize(results));
  console.log(`\nTranscripts and results: ${outDir}`);
}

function runOnce(config: Config, q: Config["questions"][number], arm: Arm, run: number, mcpConfig: string, outDir: string): Promise<RunResult> {
  const prompt = `${q.question}\n\nAnswer concisely. Name the files (repo and path) that support each point.`;
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    ...(arm === "mcp" ? ["--allowedTools", ...MCP_TOOLS] : []),
    "--disallowedTools",
    ...DENIED,
    ...config.addDirs.flatMap((d) => ["--add-dir", d]),
    ...(config.model ? ["--model", config.model] : []),
  ];
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn("claude", args, { cwd: config.workdir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("close", async (code) => {
      await writeFile(join(outDir, `${q.id}-${arm}-${run}.jsonl`), out);
      done(parse(out, { id: q.id, arm, run, ms: Date.now() - started, expect: q.expect, error: code ? err.slice(0, 300) || `exit ${code}` : undefined }));
    });
  });
}

type ResultEvent = { result?: string; usage?: Record<string, number>; total_cost_usd?: number; num_turns?: number; is_error?: boolean };

/** stream-json: tool_use blocks in assistant messages, the init event's MCP status, and the final result. */
export function parse(stream: string, meta: { id: string; arm: Arm; run: number; ms: number; expect: string[]; error?: string }): RunResult {
  const toolCalls: Record<string, number> = {};
  let result = null as ResultEvent | null;
  let mcpConnected = false;
  for (const line of stream.split("\n")) {
    if (!line.trim()) continue;
    let ev: { type?: string; subtype?: string; message?: { content?: { type: string; name?: string }[] }; mcp_servers?: { name: string; status: string }[] };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") mcpConnected = (ev.mcp_servers ?? []).some((s) => s.name === "llm-repo-wiki" && s.status === "connected");
    if (ev.type === "assistant") for (const c of ev.message?.content ?? []) if (c.type === "tool_use" && c.name) toolCalls[c.name] = (toolCalls[c.name] ?? 0) + 1;
    if (ev.type === "result") result = ev as ResultEvent;
  }
  const usage = Object.fromEntries(Object.entries(result?.usage ?? {}).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  const tokens = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].reduce((n, k) => n + (usage[k] ?? 0), 0);
  const answer = result?.result ?? "";
  return {
    id: meta.id,
    arm: meta.arm,
    run: meta.run,
    ok: !!result && !result.is_error && !meta.error,
    error: meta.error ?? (result ? undefined : "no result event"),
    tokens,
    usage,
    costUsd: result?.total_cost_usd ?? 0,
    turns: result?.num_turns ?? 0,
    ms: meta.ms,
    toolCalls,
    mcpConnected,
    recall: recall(answer, meta.expect),
    answer,
  };
}

/** Share of expected files the answer names: a cheap proxy; read the transcripts for the real grade. */
export function recall(answer: string, expect: string[]): number {
  if (expect.length === 0) return 1;
  const text = answer.toLowerCase();
  return expect.filter((e) => text.includes(e.slice(e.indexOf(":") + 1).toLowerCase())).length / expect.length;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const fmt = (xs: number[], d = 0) => `${mean(xs).toFixed(d)} ± ${sd(xs).toFixed(d)}`;

export function summarize(results: RunResult[]): string {
  const by = (arm: Arm) => results.filter((r) => r.arm === arm && r.ok);
  const g = by("grep");
  const m = by("mcp");
  const usedMcp = m.filter((r) => Object.keys(r.toolCalls).some((t) => t.startsWith("mcp__"))).length;
  const row = (name: string, f: (r: RunResult) => number, d = 0) => `| ${name} | ${fmt(g.map(f), d)} | ${fmt(m.map(f), d)} |`;
  const ratio = mean(g.map((r) => r.tokens)) ? mean(m.map((r) => r.tokens)) / mean(g.map((r) => r.tokens)) : NaN;
  const drop = mean(g.map((r) => r.recall)) - mean(m.map((r) => r.recall));
  const pass = ratio <= BAR.maxTokenRatio && drop <= BAR.maxRecallDrop;
  return [
    `| metric (mean ± sd) | grep only | grep + MCP |`,
    `|---|---|---|`,
    row("tokens (in + out + cache)", (r) => r.tokens),
    row("cost USD (client estimate)", (r) => r.costUsd, 4),
    row("turns", (r) => r.turns, 1),
    row("seconds", (r) => r.ms / 1000, 0),
    row("expected-file recall", (r) => r.recall, 2),
    "",
    `Runs ok: grep ${g.length}/${results.filter((r) => r.arm === "grep").length}, mcp ${m.length}/${results.filter((r) => r.arm === "mcp").length}. MCP connected in ${m.filter((r) => r.mcpConnected).length}, MCP tools used in ${usedMcp}.`,
    `Token ratio mcp/grep ${ratio.toFixed(2)} (bar ≤ ${BAR.maxTokenRatio}); recall drop ${drop.toFixed(2)} (bar ≤ ${BAR.maxRecallDrop}) → ${pass ? "PASSES the bar" : "does NOT pass the bar"}.`,
  ].join("\n");
}

if (process.argv[1]?.endsWith("bench-mcp.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
