import { desc, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, repos, wikiLog } from "@/db/schema";
import { QUEUES } from "@/core/contracts";
import { getRepoPipelines, type RepoPipeline } from "./pipeline";

export type QueueJob = {
  id: string;
  name: string;
  state: string;
  retryCount: number;
  createdOn: string;
  startedOn: string | null;
  completedOn: string | null;
  /** The failure message pg-boss stored, for failed jobs only. */
  error: string | null;
  /** owner/name of the repo the job works on, when it carries one. */
  repo: string | null;
};

export type AgentRunItem = {
  id: string;
  kind: string;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  repo: string | null;
};

export type ActivityItem = { at: string; action: string; repo: string | null; details: Record<string, unknown> | null };

export type JobsOverview = {
  /** Server time of this snapshot: relative times use it, so SSR and hydration render the same text. */
  asOf: string;
  pipelines: RepoPipeline[];
  jobs: QueueJob[];
  runs: AgentRunItem[];
  activity: ActivityItem[];
  totalCostUsd: number;
};

const LIMIT = 30;
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** Per-step progress lives in the pipeline cards; the feed keeps the milestones. */
const PROGRESS_EVENTS = ["author.page_started", "author.outline", "author.page_skipped", "sync.started", "sync.progress"];

/** Everything the /jobs page shows, read live. Internal pg-boss queues and the poll tick are hidden. */
export async function getJobsOverview(db: Db): Promise<JobsOverview> {
  const [{ pipelines, runRepo }, jobs, runs, activity, total] = await Promise.all([
    getRepoPipelines(db),
    listQueueJobs(db),
    db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(LIMIT),
    db
      .select({ at: wikiLog.at, action: wikiLog.action, details: wikiLog.details, owner: repos.owner, name: repos.name })
      .from(wikiLog)
      .leftJoin(repos, eq(wikiLog.repoId, repos.id))
      .where(notInArray(wikiLog.action, PROGRESS_EVENTS))
      .orderBy(desc(wikiLog.at))
      .limit(LIMIT),
    db.select({ sum: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)` }).from(agentRuns),
  ]);
  const repoName = new Map(pipelines.map((p) => [p.repoId, p.fullName]));
  return {
    asOf: new Date().toISOString(),
    pipelines,
    jobs: jobs.map(({ repoId, ...j }) => ({ ...j, repo: (repoId && repoName.get(repoId)) || null })),
    runs: runs.map((r) => ({
      id: r.id,
      kind: r.kind,
      model: r.model,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: Number(r.costUsd),
      error: r.error,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      repo: repoName.get(runRepo.get(r.id) ?? "") ?? null,
    })),
    activity: activity.map((a) => ({
      at: a.at.toISOString(),
      action: a.action,
      repo: a.owner && a.name ? `${a.owner}/${a.name}` : null,
      details: a.details ?? null,
    })),
    totalCostUsd: Number(total[0]?.sum ?? 0),
  };
}

/** pg-boss creates its schema when the worker first starts, so a fresh database has no table yet. */
async function listQueueJobs(db: Db): Promise<(Omit<QueueJob, "repo"> & { repoId: string | null })[]> {
  const exists = await db.execute<{ t: string | null }>(sql`select to_regclass('pgboss.job')::text as t`);
  if (!exists[0]?.t) return [];
  const rows = await db.execute<{
    id: string;
    name: string;
    state: string;
    retry_count: number;
    created_on: Date;
    started_on: Date | null;
    completed_on: Date | null;
    error: string | null;
    repo_id: string | null;
  }>(sql`
    select id, name, state::text as state, retry_count, created_on, started_on, completed_on, data->>'repoId' as repo_id,
      case when state = 'failed' then left(coalesce(output->>'message', output::text), 300) end as error
    from pgboss.job
    where name not like '\_\_pgboss%' and name <> ${QUEUES.pollRepos}
    order by created_on desc
    limit ${LIMIT}`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    retryCount: r.retry_count,
    createdOn: iso(r.created_on)!,
    startedOn: iso(r.started_on),
    completedOn: iso(r.completed_on),
    error: r.error,
    repoId: r.repo_id,
  }));
}
