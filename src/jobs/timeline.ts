import { and, desc, eq, like, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { repos, wikiLog } from "@/db/schema";
import { getRepoPipelines } from "./pipeline";
import type { TimelineEvent } from "./stages";

export type RunOption = { key: string; at: string; fromSha: string | null; toSha: string | null };

export type RepoTimeline = {
  asOf: string;
  repos: { id: string; fullName: string }[];
  repo: { id: string; fullName: string; status: string } | null;
  /** Newest first. A run starts at a sync and owns every event until the next one. */
  runs: RunOption[];
  selected: string | null;
  events: TimelineEvent[];
  /** The selected run is the newest and something is still moving: the view polls. */
  live: boolean;
  pendingReview: number;
};

/** Events a repo's runs are rebuilt from; most recent first, so a long history can't grow the read. */
const MAX_EVENTS = 5_000;
const MAX_RUNS = 20;

/** Splits a repo's events into runs. Syncs before progress events existed start at `repo.synced`. */
export function splitRuns(events: TimelineEvent[]): { key: string; events: TimelineEvent[] }[] {
  const started = new Set(events.filter((e) => e.action === "sync.started").map((e) => e.details.syncId));
  const runs: { key: string; events: TimelineEvent[] }[] = [];
  for (const e of events) {
    const legacy = e.action === "repo.synced" && !(e.details.syncId && started.has(e.details.syncId));
    if (e.action === "sync.started" || legacy) runs.push({ key: e.at, events: [] });
    runs.at(-1)?.events.push(e);
  }
  return runs;
}

/** A repo id from another wiki is ignored: the page falls back to this wiki's first repo. */
export async function getRepoTimeline(db: Db, wikiId: string, input: { repoId?: string; run?: string }): Promise<RepoTimeline> {
  const [repoRows, { pipelines }] = await Promise.all([
    db
      .select({ id: repos.id, owner: repos.owner, name: repos.name, status: repos.status })
      .from(repos)
      .where(eq(repos.wikiId, wikiId))
      .orderBy(repos.createdAt),
    getRepoPipelines(db, wikiId),
  ]);
  const asOf = new Date().toISOString();
  const list = repoRows.map((r) => ({ id: r.id, fullName: `${r.owner}/${r.name}` }));
  const repo = repoRows.find((r) => r.id === input.repoId) ?? repoRows[0];
  const empty = { asOf, repos: list, runs: [], selected: null, events: [], live: false, pendingReview: 0 };
  if (!repo) return { ...empty, repo: null };

  const rows = await db
    .select({ at: wikiLog.at, action: wikiLog.action, details: wikiLog.details })
    .from(wikiLog)
    .where(and(eq(wikiLog.repoId, repo.id), or(like(wikiLog.action, "sync.%"), eq(wikiLog.action, "repo.synced"), like(wikiLog.action, "author.%"))))
    .orderBy(desc(wikiLog.at))
    .limit(MAX_EVENTS);
  const events: TimelineEvent[] = rows.reverse().map((r) => ({ at: new Date(r.at).toISOString(), action: r.action, details: r.details ?? {} }));
  const runs = splitRuns(events);
  const chosen = runs.find((r) => r.key === input.run) ?? runs.at(-1);
  const newest = chosen !== undefined && chosen === runs.at(-1);

  const p = pipelines.find((x) => x.repoId === repo.id);
  const moving = !!p && [p.sync.state, p.author.state].some((s) => s === "running" || s === "waiting");
  return {
    asOf,
    repos: list,
    repo: { id: repo.id, fullName: `${repo.owner}/${repo.name}`, status: repo.status },
    runs: runs
      .slice(-MAX_RUNS)
      .reverse()
      .map((r) => {
        const first = r.events[0];
        return { key: r.key, at: first.at, fromSha: str(first.details.fromSha), toSha: str(first.details.toSha) };
      }),
    selected: chosen?.key ?? null,
    events: chosen?.events ?? [],
    live: newest && (moving || repo.status === "syncing" || repo.status === "queued"),
    pendingReview: p?.pendingReview ?? 0,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
