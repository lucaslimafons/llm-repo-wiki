import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, pageRevisions, repos, revisionSources, wikiLog } from "@/db/schema";
import { QUEUES } from "@/core/contracts";

export type StepState = "idle" | "waiting" | "running" | "done" | "stopped" | "failed";

export type RepoPipeline = {
  repoId: string;
  fullName: string;
  role: string | null;
  lastError: string | null;
  sync: {
    state: StepState;
    startedAt: string | null;
    finishedAt: string | null;
    indexed: number | null;
    embedded: number | null;
    secretsDropped: string[];
  };
  author: {
    state: StepState;
    /** 1 = next in line, for a queued job. */
    queuePosition: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    planned: number | null;
    proposed: number;
    dropped: number;
    /** Planned pages it left alone, e.g. already written or waiting for review; reasons below. */
    skipped: number;
    skipReasons: string[];
    current: string | null;
    tokens: number;
    costUsd: number;
    status: string | null;
  };
  /** Proposals citing this repo that still wait for review. */
  pendingReview: number;
};

type Job = { name: string; state: string; repo_id: string | null; created_on: Date; started_on: Date | null; completed_on: Date | null };
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function jobState(state: string | undefined): StepState {
  if (state === "created" || state === "retry") return "waiting";
  if (state === "active") return "running";
  if (state === "completed") return "done";
  if (state === "failed" || state === "cancelled") return "failed";
  return "idle";
}

/** One row per repo of the wiki: where it is in sync → author → review, read from the queue and the logs. */
export async function getRepoPipelines(db: Db, wikiId: string): Promise<{ pipelines: RepoPipeline[]; runRepo: Map<string, string> }> {
  const repoRows = await db.select().from(repos).where(eq(repos.wikiId, wikiId)).orderBy(asc(repos.createdAt));
  if (repoRows.length === 0) return { pipelines: [], runRepo: new Map() };
  const repoIds = repoRows.map((r) => r.id);

  const [jobs, logs, pending] = await Promise.all([
    latestJobs(db),
    db
      .select({ repoId: wikiLog.repoId, action: wikiLog.action, details: wikiLog.details, at: wikiLog.at })
      .from(wikiLog)
      .where(and(inArray(wikiLog.repoId, repoIds), or(eq(wikiLog.action, "repo.synced"), like(wikiLog.action, "author.%"))))
      .orderBy(asc(wikiLog.at)),
    db
      .select({ repoId: revisionSources.repoId, n: sql<number>`count(distinct ${pageRevisions.id})::int` })
      .from(revisionSources)
      .innerJoin(pageRevisions, eq(pageRevisions.id, revisionSources.revisionId))
      .where(and(eq(pageRevisions.status, "proposed"), inArray(revisionSources.repoId, repoIds)))
      .groupBy(revisionSources.repoId),
  ]);

  // The latest run per repo, from its author.started entry; the run row carries tokens and cost.
  const runRepo = new Map<string, string>();
  const latestRun = new Map<string, string>();
  for (const l of logs) {
    const runId = typeof l.details?.runId === "string" ? l.details.runId : null;
    if (l.action === "author.started" && runId && l.repoId) {
      runRepo.set(runId, l.repoId);
      latestRun.set(l.repoId, runId);
    }
  }
  const runIds = [...latestRun.values()];
  const runs = runIds.length ? await db.select().from(agentRuns).where(inArray(agentRuns.id, runIds)) : [];

  const queuedAuthors = jobs
    .filter((j) => j.name === QUEUES.authorWiki && (j.state === "created" || j.state === "retry"))
    .sort((a, b) => a.created_on.getTime() - b.created_on.getTime());

  const pipelines = repoRows.map((r): RepoPipeline => {
    const syncJob = jobs.find((j) => j.name === QUEUES.syncRepo && j.repo_id === r.id);
    const authorJob = jobs.find((j) => j.name === QUEUES.authorWiki && j.repo_id === r.id);
    const synced = logs.filter((l) => l.repoId === r.id && l.action === "repo.synced").at(-1)?.details;
    const runId = latestRun.get(r.id);
    const run = runs.find((x) => x.id === runId);
    const runLogs = runId ? logs.filter((l) => l.details?.runId === runId) : [];
    const count = (action: string) => runLogs.filter((l) => l.action === action).length;
    const planned = runLogs.findLast((l) => l.action === "author.outline")?.details?.planned;
    const position = queuedAuthors.findIndex((j) => j.repo_id === r.id);
    // Runs from before per-page skip events still carry the total in their author.finished entry.
    const skipEvents = runLogs.filter((l) => l.action === "author.page_skipped");
    const finishedSkips = runLogs.findLast((l) => l.action === "author.finished")?.details?.skipped;

    // The run row is the truth for a started run; the queue only knows about waiting.
    let authorState = jobState(authorJob?.state);
    if (run?.status === "running") authorState = "running";
    else if (run && authorState !== "waiting") {
      authorState = run.status === "succeeded" ? "done" : run.status === "budget_exceeded" ? "stopped" : "failed";
    }
    const syncState = r.status === "error" ? "failed" : r.status === "syncing" ? "running" : r.status === "queued" ? "waiting" : jobState(syncJob?.state);

    return {
      repoId: r.id,
      fullName: `${r.owner}/${r.name}`,
      role: r.role,
      lastError: r.lastError,
      sync: {
        state: syncState === "idle" && r.syncedSha ? "done" : syncState,
        startedAt: iso(syncJob?.started_on),
        finishedAt: iso(syncJob?.completed_on),
        indexed: typeof synced?.indexed === "number" ? synced.indexed : null,
        embedded: typeof synced?.embedded === "number" ? synced.embedded : null,
        secretsDropped: Array.isArray(synced?.secretsDropped)
          ? synced.secretsDropped.flatMap((s) => (s && typeof s === "object" && "path" in s ? [String(s.path)] : []))
          : [],
      },
      author: {
        state: authorState,
        queuePosition: position >= 0 ? position + 1 : null,
        startedAt: iso(run?.startedAt),
        finishedAt: iso(run?.finishedAt),
        planned: typeof planned === "number" ? planned : null,
        proposed: count("author.page_proposed"),
        dropped: count("author.page_dropped"),
        skipped: Math.max(skipEvents.length, typeof finishedSkips === "number" ? finishedSkips : 0),
        skipReasons: skipEvents.length
          ? [...new Set(skipEvents.map((l) => String(l.details?.reason)))]
          : typeof finishedSkips === "number" && finishedSkips > 0
            ? ["not recorded per page for this run"]
            : [],
        current: authorState === "running" ? (runLogs.findLast((l) => l.action === "author.page_started")?.details?.path as string | undefined) ?? null : null,
        tokens: run ? run.inputTokens + run.outputTokens : 0,
        costUsd: run ? Number(run.costUsd) : 0,
        status: run?.status ?? null,
      },
      pendingReview: pending.find((p) => p.repoId === r.id)?.n ?? 0,
    };
  });
  return { pipelines, runRepo };
}

/** The newest sync and author job per repo. pg-boss creates its schema on first start, so it may be absent. */
async function latestJobs(db: Db): Promise<Job[]> {
  const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('pgboss.job')::text as t`);
  if (!exists[0]?.t) return [];
  const rows = await db.execute<Job>(sql`
    select distinct on (name, data->>'repoId') name, state::text as state, data->>'repoId' as repo_id,
      created_on, started_on, completed_on
    from pgboss.job
    where name in (${QUEUES.syncRepo}, ${QUEUES.authorWiki})
    order by name, data->>'repoId', created_on desc`);
  return rows.map((r) => ({ ...r, created_on: new Date(r.created_on), started_on: r.started_on && new Date(r.started_on), completed_on: r.completed_on && new Date(r.completed_on) }));
}
