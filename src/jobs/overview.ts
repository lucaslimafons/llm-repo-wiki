import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, repos, wikiLog } from "@/db/schema";
import { QUEUES } from "@/core/contracts";
import { listRepos, type RepoListItem } from "@/ingest/repos";

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
};

export type ActivityItem = { at: string; action: string; repo: string | null; details: Record<string, unknown> | null };

export type JobsOverview = {
  /** Server time of this snapshot: relative times use it, so SSR and hydration render the same text. */
  asOf: string;
  repos: RepoListItem[];
  jobs: QueueJob[];
  runs: AgentRunItem[];
  activity: ActivityItem[];
  totalCostUsd: number;
};

const LIMIT = 30;
const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** Everything the /jobs page shows, read live. Internal pg-boss queues and the poll tick are hidden. */
export async function getJobsOverview(db: Db): Promise<JobsOverview> {
  const [repoList, jobs, runs, activity, total] = await Promise.all([
    listRepos(db),
    listQueueJobs(db),
    db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(LIMIT),
    db
      .select({ at: wikiLog.at, action: wikiLog.action, details: wikiLog.details, owner: repos.owner, name: repos.name })
      .from(wikiLog)
      .leftJoin(repos, eq(wikiLog.repoId, repos.id))
      .orderBy(desc(wikiLog.at))
      .limit(LIMIT),
    db.select({ sum: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)` }).from(agentRuns),
  ]);
  return {
    asOf: new Date().toISOString(),
    repos: repoList,
    jobs,
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
async function listQueueJobs(db: Db): Promise<QueueJob[]> {
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
  }>(sql`
    select id, name, state::text as state, retry_count, created_on, started_on, completed_on,
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
  }));
}
