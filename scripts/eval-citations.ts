/**
 * Citation precision: does each cited sentence say what its cited lines say? The author's grounding
 * check only proves a citation points at retrieved lines; this judges the claim against them.
 * No human labels: two judges from different vendors, plus planted wrong citations with a known
 * answer that measure how lenient each judge is.
 *
 *   pnpm eval:citations --wiki <slug> --checkout owner/name=/path/to/clone [--checkout …]
 *     [--judges a,b] [--plant 0.2] [--limit n] [--seed 1] [--resume eval/results/citations/<run>]
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Citation } from "@/core/contracts";
import { isSystemicError } from "@/agent/author";
import { stepCost } from "@/agent/runs";
import { formatSourceHref, parseSourceHref } from "@/lib/source-links";

const DEFAULT_JUDGES = ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"];
/** Longer cited ranges are cut here, and the pair is marked truncated in the report. */
const MAX_EXCERPT_LINES = 200;
const CONCURRENCY = 6;

export type Claim = { id: string; page: string; heading: string; text: string; citations: Citation[] };
export type Pair = Claim & { planted: false } | (Claim & { planted: true; decoy: "same-file" | "other-file"; original: Citation[] });
export const VERDICTS = ["supported", "partial", "unsupported"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Judgment = { judge: string; pairId: string; verdict: Verdict; quote: string; missing: string; quoteValid: boolean; costUsd: number; error?: string };

const LINK_RE = /\[([^\]]*)\]\(\s*<?(source:[^)\s>]+)>?\s*\)/g;

/**
 * Every sentence that carries at least one source link, with its section heading. Code fences and
 * "Unverified" callouts are skipped: the first holds no claims, the second already says it is unsupported.
 */
export function extractClaims(page: string, bodyMd: string): Claim[] {
  const out: Claim[] = [];
  let heading = page;
  let inFence = false;
  const blocks: { heading: string; text: string }[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) blocks.push({ heading, text: buf.join(" ") });
    buf = [];
  };
  for (const raw of bodyMd.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1];
      continue;
    }
    if (!line || /^>\s*\**unverified/i.test(line)) {
      flush();
      continue;
    }
    // A list item or table row is its own block; prose lines join into a paragraph.
    if (/^([-*+]|\d+\.|\|)\s/.test(line)) flush();
    buf.push(line.replace(/^([-*+]|\d+\.|>)\s+/, ""));
    if (/^\|/.test(line)) flush();
  }
  flush();

  for (const b of blocks) {
    // A dot ends a sentence only before whitespace and a capital or backtick, so `persist.md#L7` stays whole.
    for (const sentence of b.text.split(/(?<=[.!?])\s+(?=[A-Z`*])/)) {
      const citations: Citation[] = [];
      for (const m of sentence.matchAll(LINK_RE)) {
        const c = parseSourceHref(m[2]);
        if (c && !citations.some((x) => formatSourceHref(x) === formatSourceHref(c))) citations.push(c);
      }
      if (!citations.length) continue;
      // A link is usually just the citation and is dropped; when the sentence would then end on "in" or
      // "see", the link was its object ("documented in [x]"), so it keeps its text.
      const tidy = (s: string) => s.replace(/\(\s*[,;]?\s*\)/g, "").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
      const dropped = tidy(sentence.replace(LINK_RE, ""));
      const text = /\b(in|at|see|from|by|to|under|of|on)[.!?]?$/i.test(dropped) ? tidy(sentence.replace(LINK_RE, "[$1]")) : dropped;
      out.push({ id: `${page}#${out.length + 1}`, page, heading: b.heading, text, citations });
    }
  }
  return out;
}

/** Deterministic PRNG, so a seed reproduces the same planted pairs. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (a: Citation, b: Citation) =>
  a.repo === b.repo && a.path === b.path && (!a.startLine || !b.startLine || (a.startLine <= (b.endLine ?? b.startLine) && b.startLine <= (a.endLine ?? a.startLine)));

/**
 * Copies a share of the claims with every citation swapped for one that cites other lines: half from
 * the same file when it has any (hard: same topic), half from another file (easy). Answer: not supported.
 */
export function plantDecoys(claims: Claim[], rate: number, rng: () => number): Pair[] {
  const pool = [...new Map(claims.flatMap((c) => c.citations).filter((c) => c.startLine).map((c) => [formatSourceHref(c), c])).values()];
  const planted: Pair[] = [];
  for (const claim of claims) {
    if (rng() >= rate) continue;
    const free = pool.filter((p) => !claim.citations.some((c) => overlaps(c, p)));
    const paths = new Set(claim.citations.map((c) => c.path));
    const same = free.filter((p) => paths.has(p.path));
    const other = free.filter((p) => !paths.has(p.path));
    const useSame = same.length > 0 && (other.length === 0 || rng() < 0.5);
    const from = useSame ? same : other;
    if (!from.length) continue;
    const decoy = from[Math.floor(rng() * from.length)];
    planted.push({ ...claim, id: `${claim.id}~planted`, citations: [decoy], planted: true, decoy: useSame ? "same-file" : "other-file", original: claim.citations });
  }
  return [...claims.map((c) => ({ ...c, planted: false as const })), ...planted];
}

/** The cited lines with their numbers, as the judge sees them. */
export function excerpt(fileLines: string[], c: Citation): { text: string; truncated: boolean } {
  const start = c.startLine ?? 1;
  const end = Math.min(c.endLine ?? (c.startLine ? c.startLine : fileLines.length), fileLines.length);
  const last = Math.min(end, start + MAX_EXCERPT_LINES - 1);
  const body = fileLines.slice(start - 1, last).map((l, i) => `${start + i}: ${l}`).join("\n");
  return { text: body, truncated: last < end };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** A quote counts only if every line of it appears verbatim in the excerpts (line numbers and spacing aside). */
export function quoteFound(quote: string, excerpts: string): boolean {
  const lines = quote.split("\n").map((l) => norm(l.replace(/^\s*\d+:\s?/, ""))).filter(Boolean);
  if (!lines.length) return false;
  const hay = norm(excerpts.split("\n").map((l) => l.replace(/^\d+: /, "")).join("\n"));
  return lines.every((l) => hay.includes(l));
}

/** Cohen's kappa: agreement between two raters corrected for what chance alone would give. */
export function cohensKappa(a: Verdict[], b: Verdict[]): number {
  const n = a.length;
  if (!n) return NaN;
  const po = a.filter((v, i) => v === b[i]).length / n;
  const pe = VERDICTS.reduce((s, v) => s + (a.filter((x) => x === v).length / n) * (b.filter((x) => x === v).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const judgmentSchema = z.object({
  verdict: z.enum(VERDICTS),
  quote: z.string().describe("The source line(s) that best support the claim, copied verbatim without line numbers. Empty when unsupported."),
  missing: z.string().describe("For partial or unsupported: the part of the claim the lines do not support. Empty when supported."),
});

export const JUDGE_INSTRUCTIONS = `You check citations in a technical wiki. You get one claim and the exact source lines it cites.
Decide from these lines only. Do not use what you already know about the project or library.

- supported: every factual part of the claim is stated in the lines, or follows directly from reading the code in them.
- partial: at least one factual part is supported and at least one is not.
- unsupported: the lines do not state or show the claim.

Different wording is fine. A detail the lines do not contain (a number, a default, a name, a reason, an order of events) is not supported, even if it is probably true.
quote: copy the line(s) that best support the claim, verbatim. Empty when unsupported.
missing: what the lines do not support. Empty when supported.`;

export function judgePrompt(pair: Pair, excerpts: string): string {
  return `Page: ${pair.page}\nSection: ${pair.heading}\n\nClaim:\n${pair.text}\n\nCited source lines:\n${excerpts}`;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** Per judge: verdicts on real claims, planted errors caught, invalid quotes; then agreement and consensus. */
export function summarize(pairs: Pair[], judgments: Judgment[], judges: string[]): string {
  const byPair = new Map<string, Map<string, Judgment>>();
  for (const j of judgments) {
    if (!byPair.has(j.pairId)) byPair.set(j.pairId, new Map());
    byPair.get(j.pairId)!.set(j.judge, j);
  }
  const real = pairs.filter((p) => !p.planted);
  const planted = pairs.filter((p) => p.planted);
  const ok = (p: Pair, judge: string) => {
    const j = byPair.get(p.id)?.get(judge);
    return j && !j.error ? j : undefined;
  };
  const lines = [`Pairs: ${real.length} real claims, ${planted.length} planted wrong citations.`, ""];
  lines.push(`| judge | supported | partial | unsupported | planted caught | supported with a quote not in the lines | errors | cost |`, `|---|---|---|---|---|---|---|---|`);
  for (const judge of judges) {
    const r = real.map((p) => ok(p, judge)).filter((j): j is Judgment => !!j);
    const pl = planted.map((p) => ok(p, judge)).filter((j): j is Judgment => !!j);
    const share = (v: Verdict) => pct(r.filter((j) => j.verdict === v).length / (r.length || 1));
    const caught = pl.filter((j) => j.verdict !== "supported").length;
    const badQuote = r.filter((j) => j.verdict !== "unsupported" && !j.quoteValid).length;
    const errors = judgments.filter((j) => j.judge === judge && j.error).length;
    const cost = judgments.filter((j) => j.judge === judge).reduce((s, j) => s + j.costUsd, 0);
    lines.push(`| ${judge} | ${share("supported")} | ${share("partial")} | ${share("unsupported")} | ${caught}/${pl.length} (${pct(caught / (pl.length || 1))}) | ${badQuote} | ${errors} | $${cost.toFixed(2)} |`);
  }
  if (judges.length === 2) {
    const [a, b] = judges;
    const both = real.filter((p) => ok(p, a) && ok(p, b));
    const va = both.map((p) => ok(p, a)!.verdict);
    const vb = both.map((p) => ok(p, b)!.verdict);
    const agreed = both.filter((_, i) => va[i] === vb[i]);
    const agreedSupported = agreed.filter((p) => ok(p, a)!.verdict === "supported").length;
    lines.push(
      "",
      `Agreement on real claims: ${agreed.length}/${both.length} (${pct(agreed.length / (both.length || 1))}), Cohen's kappa ${cohensKappa(va, vb).toFixed(2)}.`,
      `Where both judges agree, ${agreedSupported}/${agreed.length} claims are supported (${pct(agreedSupported / (agreed.length || 1))}): the citation-precision estimate.`,
      `Disputed: ${both.length - agreed.length} claims, listed in disputed.md for a human to read.`,
    );
  }
  return lines.join("\n");
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const args = (name: string) => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));

async function main() {
  const { db } = await import("@/db/client");
  const { sql } = await import("drizzle-orm");
  const { openRouterKey } = await import("@/lib/env");
  const { providerPrivacy } = await import("@/lib/openrouter-privacy");

  const slug = arg("wiki");
  const checkouts = new Map(args("checkout").map((s) => s.split("=") as [string, string]));
  if (!slug || !checkouts.size) {
    console.error("usage: pnpm eval:citations --wiki <slug> --checkout owner/name=/path/to/clone [--judges a,b] [--plant 0.2] [--limit n] [--seed 1]");
    process.exit(1);
  }
  const judges = arg("judges")?.split(",") ?? DEFAULT_JUDGES;
  const rate = Number(arg("plant") ?? 0.2);
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const rng = mulberry32(Number(arg("seed") ?? 1));
  // Resume reuses the earlier run's pairs (same plants) and every judgment that did not error.
  const resumeDir = arg("resume");
  const previous = resumeDir
    ? (JSON.parse(await readFile(join(resumeDir, "results.json"), "utf8")) as { pairs: Pair[]; judgments: Judgment[] })
    : undefined;

  let pairs: Pair[];
  if (previous) pairs = previous.pairs;
  else {
    // Full path, not title: siblings under different parents can share a title, and the id must be unique.
    // The approved revision when there is one, otherwise the newest proposal.
    const rows = await db().execute<{ path: string; body_md: string }>(sql`
      with recursive tree as (
        select p.id, p.title::text as path from pages p join wikis w on w.id = p.wiki_id where w.slug = ${slug} and p.parent_id is null
        union all
        select c.id, tree.path || '/' || c.title from pages c join tree on c.parent_id = tree.id
      )
      select tree.path, coalesce(cur.body_md, latest.body_md) as body_md
      from tree join pages p on p.id = tree.id
      left join page_revisions cur on cur.id = p.current_revision_id
      left join lateral (select body_md from page_revisions r where r.page_id = p.id order by r.created_at desc limit 1) latest on true
      order by tree.path`);
    if (!rows.length) throw new Error(`wiki "${slug}" has no pages`);
    let claims = rows.flatMap((r) => extractClaims(r.path, r.body_md));
    if (limit) claims = claims.slice(0, limit);
    pairs = plantDecoys(claims, rate, rng);
  }
  if (new Set(pairs.map((p) => p.id)).size !== pairs.length) throw new Error("pair ids collide: judgments would be filed under the wrong claim");
  const kept = (previous?.judgments ?? []).filter((j) => !j.error && judges.includes(j.judge));
  const keptKeys = new Set(kept.map((j) => `${j.judge} ${j.pairId}`));

  const exec = promisify(execFile);
  const files = new Map<string, string[]>();
  async function fileLines(c: Citation): Promise<string[]> {
    const key = `${c.repo}@${c.commitSha}:${c.path}`;
    if (!files.has(key)) {
      const dir = checkouts.get(c.repo);
      if (!dir) throw new Error(`no --checkout for ${c.repo}`);
      const { stdout } = await exec("git", ["-C", dir, "show", `${c.commitSha}:${c.path}`], { maxBuffer: 32 * 1024 * 1024 });
      files.set(key, stdout.split("\n"));
    }
    return files.get(key)!;
  }
  const excerpts = new Map<string, { text: string; truncated: boolean }>();
  for (const p of pairs) {
    const parts = await Promise.all(p.citations.map(async (c) => ({ c, e: excerpt(await fileLines(c), c) })));
    excerpts.set(p.id, {
      text: parts.map(({ c, e }) => `--- ${c.repo}/${c.path}${e.truncated ? ` (first ${MAX_EXCERPT_LINES} lines of the range)` : ""}\n${e.text}`).join("\n\n"),
      truncated: parts.some(({ e }) => e.truncated),
    });
  }

  const provider = createOpenRouter({ apiKey: openRouterKey() });
  const models: Record<string, LanguageModel> = Object.fromEntries(judges.map((j) => [j, provider.chat(j, { usage: { include: true }, ...providerPrivacy() })]));
  // Shuffled, so planted pairs are not judged next to the claim they copy.
  const tasks = judges
    .flatMap((judge) => pairs.map((pair) => ({ judge, pair, k: rng() })))
    .filter((t) => !keptKeys.has(`${t.judge} ${t.pair.id}`))
    .sort((a, b) => a.k - b.k);
  console.error(`${tasks.length} judgments to make${kept.length ? `, ${kept.length} reused` : ""}`);
  let done = 0;
  // Out of credit, rate-limited or a revoked key: every later call fails the same way, so stop.
  let stopped: string | undefined;
  const fresh = await pool(tasks, CONCURRENCY, async ({ judge, pair }): Promise<Judgment | undefined> => {
    if (stopped) return undefined;
    const ex = excerpts.get(pair.id)!.text;
    try {
      const out = await generateText({
        model: models[judge],
        instructions: JUDGE_INSTRUCTIONS,
        prompt: judgePrompt(pair, ex),
        output: Output.object({ schema: judgmentSchema }),
        maxOutputTokens: 4_000,
        timeout: { totalMs: 120_000 },
      });
      const j = out.output;
      if (++done % 25 === 0) console.error(`${done}/${tasks.length} judged`);
      return { judge, pairId: pair.id, ...j, quoteValid: quoteFound(j.quote, ex), costUsd: stepCost(out.providerMetadata) };
    } catch (err) {
      done++;
      const error = String(err instanceof Error ? err.message : err).slice(0, 300);
      if (isSystemicError(err)) {
        stopped ??= error;
        return undefined;
      }
      return { judge, pairId: pair.id, verdict: "unsupported", quote: "", missing: "", quoteValid: false, costUsd: 0, error };
    }
  });
  const judgments = [...kept, ...fresh.filter((j): j is Judgment => !!j)];

  const outDir = join(process.cwd(), "eval/results/citations", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outDir, { recursive: true });
  const summary = summarize(pairs, judgments, judges);
  const view = (p: Pair) => {
    const js = judges.map((j) => judgments.find((x) => x.judge === j && x.pairId === p.id) ?? { judge: j, error: "not judged (run stopped early)" } as Judgment);
    return [
      `### ${p.id}${p.planted ? ` (planted, ${p.decoy})` : ""}`,
      `> ${p.text}`,
      "",
      ...p.citations.map((c) => `- cites \`${formatSourceHref(c)}\``),
      ...js.map((j) => `- **${j.judge}**: ${j.error ? `error: ${j.error}` : `${j.verdict}${j.missing ? `, missing: ${j.missing}` : ""}${j.quote ? `\n  quote${j.quoteValid ? "" : " (NOT in the lines)"}: \`${norm(j.quote).slice(0, 300)}\`` : ""}`}`),
      "",
      "```",
      excerpts.get(p.id)!.text.split("\n").slice(0, 60).join("\n"),
      "```",
      "",
    ].join("\n");
  };
  const verdictOf = (p: Pair, j: string) => judgments.find((x) => x.judge === j && x.pairId === p.id);
  const judged = (p: Pair) => judges.map((j) => verdictOf(p, j)).filter((j) => j && !j.error);
  const disputed = pairs.filter((p) => !p.planted && judged(p).length === judges.length && new Set(judged(p).map((j) => j!.verdict)).size > 1);
  const missedPlants = pairs.filter((p) => p.planted && judges.some((j) => verdictOf(p, j)?.verdict === "supported"));
  const agreedUnsupported = pairs.filter((p) => !p.planted && judges.every((j) => verdictOf(p, j)?.verdict === "unsupported"));
  await writeFile(join(outDir, "results.json"), JSON.stringify({ judges, pairs, judgments, truncated: [...excerpts].filter(([, e]) => e.truncated).map(([id]) => id) }, null, 2));
  await writeFile(join(outDir, "summary.md"), `${summary}\n\nExcerpts cut at ${MAX_EXCERPT_LINES} lines: ${[...excerpts.values()].filter((e) => e.truncated).length} pairs.\n`);
  await writeFile(join(outDir, "disputed.md"), `# Judges disagree (${disputed.length})\n\n${disputed.map(view).join("\n")}`);
  await writeFile(join(outDir, "planted-missed.md"), `# Planted wrong citations a judge called supported (${missedPlants.length})\n\nRead these first: the decoy may support the claim by chance (docs repeat themselves).\n\n${missedPlants.map(view).join("\n")}`);
  await writeFile(join(outDir, "unsupported.md"), `# Real claims both judges call unsupported (${agreedUnsupported.length})\n\n${agreedUnsupported.map(view).join("\n")}`);
  console.log(summary);
  console.log(`\nResults: ${outDir}`);
  await db().$client.end();
  if (stopped) {
    console.error(`\nStopped early: ${stopped}\nFix it, then finish with: pnpm eval:citations --wiki ${slug} ${args("checkout").map((c) => `--checkout ${c}`).join(" ")} --resume ${outDir}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("eval-citations.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
