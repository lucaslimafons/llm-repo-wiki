import { eq } from "drizzle-orm";
import { generateText, isStepCount, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { Citation, JobPayloads, PageView, QUEUES, SearchHit, SearchInput, TreeNode, WikiStore } from "@/core/contracts";
import type { Db } from "@/db/client";
import { repos, wikiLog } from "@/db/schema";
import { parseSourceHref } from "@/lib/source-links";
import { modelName } from "./models";
import { buildAuthorInstructions, loadWikiSchema } from "./prompts";
import { wrapRetrieved } from "./retrieved";
import { startAgentRun } from "./runs";
import { createWikiTools, treeToText } from "./tools";
import { parentOf, wikiPathSchema } from "./wiki-path";

export type AuthorPayload = JobPayloads[typeof QUEUES.authorWiki];

export type AuthorDeps = {
  db: Db;
  store: WikiStore;
  search: (input: SearchInput) => Promise<SearchHit[]>;
  model: LanguageModel;
  loadSchema?: () => Promise<string>;
  /** WIKI_SCHEMA.md's page budget. */
  maxPages?: number;
  maxStepsPerPage?: number;
  /** Input + output tokens for the whole run; the job stops proposing once it is spent. */
  tokenBudget?: number;
};

export type AuthorResult = {
  mode: "initial" | "incremental" | "skipped";
  proposed: string[];
  dropped: { path: string; reason: string }[];
  skipped: { path: string; reason: string }[];
  status: "succeeded" | "budget_exceeded";
};

const outlineSchema = z.object({
  pages: z
    .array(
      z.object({
        path: z.string().describe("Display path, e.g. 'Architecture/Ingestion'. Parents come before children."),
        purpose: z.string().describe("One sentence: what this page explains."),
        queries: z.array(z.string()).max(4).describe("Searches that will find the evidence for it."),
      }),
    )
    .max(60),
});

const pageDraftSchema = z.object({
  bodyMd: z.string().describe("The page in markdown, every claim cited inline as [path#Lx-Ly](source:...)."),
  citations: z.array(z.string()).describe("Every source: href the body cites."),
});

const SOURCE_LINK = /\]\((source:[^)\s]+)\)/g;

/** Union of the returned citations and the ones linked in the body, limited to this repo. */
export function collectCitations(repo: string, bodyMd: string, hrefs: string[]): Citation[] {
  const all = [...hrefs, ...[...bodyMd.matchAll(SOURCE_LINK)].map((m) => m[1])];
  const out = new Map<string, Citation>();
  for (const href of all) {
    const c = parseSourceHref(href.trim());
    if (c && c.repo === repo) out.set(`${c.path}#${c.startLine ?? ""}-${c.endLine ?? ""}@${c.commitSha}`, c);
  }
  return [...out.values()];
}

/** The reason string doubles as the idempotency key: a retried job skips what it already proposed. */
export function proposalReason(toSha: string, why: string) {
  return `author-wiki ${toSha}: ${why}`.slice(0, 500);
}

/** Job-level entries. The page id stays in details: the store logs its own write with the FK. */
async function log(db: Db, action: string, input: { repoId: string; pageId?: string; details?: Record<string, unknown> }) {
  const details = { ...input.details, ...(input.pageId ? { pageId: input.pageId } : {}) };
  await db.insert(wikiLog).values({ actor: "agent", action, repoId: input.repoId, details });
}

/**
 * Every page with its citations, through the store contract only (a repo has ≤ ~30 pages, so the
 * walk is cheap), so the job doesn't depend on how Track B lays out revisions.
 */
async function allPages(store: WikiStore): Promise<PageView[]> {
  const ids: string[] = [];
  const walk = (nodes: TreeNode[]) => nodes.forEach((n) => (ids.push(n.id), walk(n.children)));
  walk(await store.listTree());
  const views = await Promise.all(ids.map((id) => store.getPage({ id })));
  return views.filter((v): v is PageView => v !== null);
}

/**
 * The author-wiki job. First run: plan an outline under the page budget, then write each page.
 * Later runs: re-propose only the pages that cite changed files. Every write is a proposal; this
 * job has no delete or move tool at all.
 */
export async function runAuthorJob(deps: AuthorDeps, payload: AuthorPayload): Promise<AuthorResult> {
  const { db, store } = deps;
  const maxPages = deps.maxPages ?? 30;
  const maxSteps = deps.maxStepsPerPage ?? 6;
  const tokenBudget = deps.tokenBudget ?? 400_000;
  const result: AuthorResult = { mode: "skipped", proposed: [], dropped: [], skipped: [], status: "succeeded" };

  const [repo] = await db.select().from(repos).where(eq(repos.id, payload.repoId));
  if (!repo) return result;
  const repoName = `${repo.owner}/${repo.name}`;

  const run = await startAgentRun(db, { kind: "author", model: modelName(deps.model) });
  const author = { kind: "agent" as const, agentRunId: run.id };
  // Evidence only: source scope, this repo. The write tools are deliberately not handed over.
  const { searchKnowledge } = createWikiTools({
    store,
    search: (input) => deps.search({ ...input, scope: "source", repo: repoName }),
    author,
    mode: "propose",
  });
  const instructions = buildAuthorInstructions({ schema: await (deps.loadSchema ?? loadWikiSchema)(), repo: repoName, sha: payload.toSha });
  const overBudget = () => {
    const t = run.totals();
    return t.inputTokens + t.outputTokens >= tokenBudget;
  };

  async function draft(prompt: string) {
    const out = await generateText({
      model: deps.model,
      instructions,
      prompt,
      tools: { searchKnowledge },
      output: Output.object({ schema: pageDraftSchema }),
      stopWhen: isStepCount(maxSteps),
      maxOutputTokens: 6_000,
      onStepEnd: (step) => run.addStep(step),
    });
    return out.output;
  }

  await log(db, "author.started", { repoId: repo.id, details: { runId: run.id, fromSha: payload.fromSha, toSha: payload.toSha, changed: payload.changedPaths.length } });
  try {
    const existing = await allPages(store);
    const citing = existing.filter((p) => p.citations.some((c) => c.repo === repoName));
    // fromSha null = first sync. A retried first run lands here again and skips written paths.
    if (payload.fromSha === null || citing.length === 0) {
      result.mode = "initial";
      await writeInitial(new Set(citing.map((p) => p.path)));
    } else {
      result.mode = "incremental";
      await writeIncremental(citing);
    }
    await run.finish({ status: result.status });
    await log(db, "author.finished", {
      repoId: repo.id,
      details: { runId: run.id, mode: result.mode, status: result.status, proposed: result.proposed.length, dropped: result.dropped, skipped: result.skipped.length },
    });
    return result;
  } catch (error) {
    await run.finish({ status: "failed", error });
    await log(db, "author.failed", { repoId: repo.id, details: { runId: run.id, error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }

  async function drop(path: string, reason: string, pageId?: string) {
    result.dropped.push({ path, reason });
    await log(db, "author.page_dropped", { repoId: repo.id, pageId, details: { runId: run.id, path, reason } });
  }

  async function writeInitial(existing: Set<string>) {
    const tree = await store.listTree();
    const plan = await generateText({
      model: deps.model,
      instructions,
      prompt: [
        `Plan the wiki OUTLINE for ${repoName}: at most ${maxPages} pages in total, parents listed before their children, following the schema's structure.`,
        `Existing wiki index (extend it, don't duplicate it):\n${treeToText(tree)}`,
      ].join("\n\n"),
      tools: { searchKnowledge },
      output: Output.object({ schema: outlineSchema }),
      stopWhen: isStepCount(maxSteps),
      maxOutputTokens: 4_000,
      onStepEnd: (step) => run.addStep(step),
    });

    // Pages this repo already has (e.g. from a retried run) count once, against the same budget.
    const planned = new Set<string>(existing);
    for (const item of plan.output.pages) {
      const path = wikiPathSchema.safeParse(item.path.trim());
      if (!path.success) {
        await drop(item.path, "invalid path");
        continue;
      }
      if (existing.has(path.data)) {
        result.skipped.push({ path: path.data, reason: "exists" });
        continue;
      }
      if (planned.has(path.data)) continue;
      if (planned.size >= maxPages) {
        await drop(path.data, `page budget of ${maxPages} reached`);
        continue;
      }
      if (overBudget()) {
        result.status = "budget_exceeded";
        return;
      }
      planned.add(path.data);
      await writeNewPage(path.data, item.purpose, item.queries);
    }
  }

  async function writeNewPage(path: string, purpose: string, queries: string[]) {
    if (await store.getPage({ path })) {
      result.skipped.push({ path, reason: "exists" });
      return;
    }
    const parentPath = parentOf(path);
    const parent = parentPath ? await store.getPage({ path: parentPath }) : null;
    if (parentPath && !parent) return drop(path, `parent "${parentPath}" was not written`);

    const page = await draft(
      [
        `Write the wiki page "${path}" for ${repoName}. Purpose: ${purpose}`,
        `Start by searching${queries.length ? ` (suggested: ${queries.map((q) => JSON.stringify(q)).join(", ")})` : ""}. Cite every claim.`,
      ].join("\n"),
    );
    const citations = collectCitations(repoName, page.bodyMd, page.citations);
    if (citations.length === 0) return drop(path, "the draft cited no sources");
    const title = path.split("/").at(-1)!;
    const { pageId } = await store.createPage({
      parentId: parent?.id ?? null,
      title,
      bodyMd: page.bodyMd,
      reason: proposalReason(payload.toSha, purpose),
      citations,
      author,
      mode: "propose",
    });
    result.proposed.push(path);
    await log(db, "author.page_proposed", { repoId: repo.id, pageId, details: { runId: run.id, path, citations: citations.length } });
  }

  async function writeIncremental(citing: PageView[]) {
    const changed = new Set(payload.changedPaths);
    const affected = citing.filter((p) => p.stale || p.citations.some((c) => c.repo === repoName && changed.has(c.path)));
    for (const page of affected.slice(0, maxPages)) {
      if (overBudget()) {
        result.status = "budget_exceeded";
        return;
      }
      const pageId = page.id;
      if (page.revisionId === null) {
        result.skipped.push({ path: page.path, reason: "still an unreviewed proposal" });
        continue;
      }
      const revisions = await store.listRevisions(pageId);
      if (revisions.some((r) => r.status === "proposed" && r.reason?.startsWith(proposalReason(payload.toSha, "")))) {
        result.skipped.push({ path: page.path, reason: "already proposed for this sha" });
        continue;
      }
      const cited = [...new Set(page.citations.filter((c) => c.repo === repoName && changed.has(c.path)).map((c) => c.path))];
      const updated = await draft(
        [
          `The repository ${repoName} changed (${payload.fromSha ?? "?"} → ${payload.toSha}). Update the wiki page "${page.path}" so it matches the code at ${payload.toSha}.`,
          `Changed files this page cites: ${cited.length ? cited.join(", ") : "(none; the page was marked stale)"}.`,
          `Search the changed files again, keep what is still true, fix what changed, and cite the new lines. The current page:`,
          wrapRetrieved(`wiki/${page.path}`, page.bodyMd),
        ].join("\n\n"),
      );
      const citations = collectCitations(repoName, updated.bodyMd, updated.citations);
      if (citations.length === 0) {
        await drop(page.path, "the updated draft cited no sources", pageId);
        continue;
      }
      await store.updatePage({
        pageId,
        baseRevisionId: page.revisionId,
        bodyMd: updated.bodyMd,
        reason: proposalReason(payload.toSha, `update after changes to ${cited.join(", ") || "stale sources"}`),
        citations,
        author,
        mode: "propose",
      });
      result.proposed.push(page.path);
      await log(db, "author.page_proposed", { repoId: repo.id, pageId, details: { runId: run.id, path: page.path, citations: citations.length, update: true } });
    }
  }
}
