"use client";

import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Radio, RotateCcw } from "lucide-react";
import { useState } from "react";
import { repoTimelineSchema } from "@/core/api-schemas";
import { activeStage, deriveStages } from "@/jobs/stages";
import type { RepoTimeline } from "@/jobs/timeline";
import { fetchJson } from "@/lib/fetch-json";
import { queryKeys } from "@/lib/query-keys";
import { StageRail } from "./StageRail";
import { useNow } from "./useNow";

const LIVE_POLL_MS = 1500;
/** A replay lasts about this long however many events the run logged. */
const REPLAY_MS = 20_000;

type Replay = { startedAt: number; from: number } | null;

const fetchTimeline = (repo: string | null, run: string | null) => {
  const q = new URLSearchParams();
  if (repo) q.set("repo", repo);
  if (run) q.set("run", run);
  return fetchJson(`/api/pipeline?${q}`, repoTimelineSchema);
};

export function PipelineView({ initial }: { initial: RepoTimeline }) {
  const [repoId, setRepoId] = useState<string | null>(initial.repo?.id ?? null);
  const [run, setRun] = useState<string | null>(null);
  /** null: follow the end of the run (live). A number: replay position in the event list. */
  const [position, setPosition] = useState<number | null>(null);
  const [replay, setReplay] = useState<Replay>(null);

  const timeline = useQuery({
    queryKey: queryKeys.jobs.timeline(repoId, run),
    queryFn: () => fetchTimeline(repoId, run),
    initialData: repoId === (initial.repo?.id ?? null) && run === null ? initial : undefined,
    refetchInterval: (q) => (q.state.data?.live ? LIVE_POLL_MS : false),
  });
  const t = timeline.data;
  const events = t?.events ?? [];
  const last = events.length - 1;
  const stepMs = Math.min(600, Math.max(40, REPLAY_MS / Math.max(1, events.length)));

  const now = useNow(replay !== null);
  const playingAt = replay ? Math.min(last, replay.from + Math.floor((now - replay.startedAt) / stepMs)) : null;
  const playing = replay !== null && playingAt !== null && playingAt < last;
  // The replay reached the end: stop the clock and follow the run again (a render-time update).
  if (replay !== null && !playing) {
    setReplay(null);
    setPosition(null);
  }
  const at = playingAt ?? position ?? last;
  const following = replay === null && position === null;
  const shown = events.slice(0, at + 1);
  const ongoing = at < last || (following && !!t?.live);
  const { stages, feed } = deriveStages(shown, { ongoing, pendingReview: following ? (t?.pendingReview ?? null) : null });

  const choose = (next: { repo?: string | null; run?: string | null }) => {
    if (next.repo !== undefined) setRepoId(next.repo);
    setRun(next.run ?? null);
    setPosition(null);
    setReplay(null);
  };
  const play = () => setReplay({ startedAt: Date.now(), from: at >= last ? 0 : at });
  const pause = () => {
    setPosition(at);
    setReplay(null);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-muted">
        How a repository becomes wiki pages: each stage lights up as it runs, with the numbers it produced. Watch a run live, or replay a finished one
        from its log.
      </p>
      {timeline.error && <p className="mb-4 text-sm text-danger">{timeline.error.message}</p>}

      {!t || !t.repo ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">Add a repository on the home page to see its pipeline.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted">Repository</span>
              <select
                id="pipeline-repo"
                className="rounded border border-line bg-surface px-2 py-1"
                value={t.repo.id}
                onChange={(e) => choose({ repo: e.target.value })}
              >
                {t.repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted">Run</span>
              <select
                id="pipeline-run"
                className="rounded border border-line bg-surface px-2 py-1"
                value={t.selected ?? ""}
                onChange={(e) => choose({ run: e.target.value === t.runs[0]?.key ? null : e.target.value })}
                disabled={t.runs.length === 0}
              >
                {t.runs.length === 0 && <option value="">No runs yet</option>}
                {t.runs.map((r, i) => (
                  <option key={r.key} value={r.key}>
                    {new Date(r.at).toLocaleString()} · {r.toSha?.slice(0, 7) ?? "?"}
                    {i === 0 ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            {playing ? (
              <button type="button" onClick={pause} className="flex items-center gap-1 rounded border border-line bg-surface px-3 py-1 text-sm">
                <Pause className="size-4" /> Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={play}
                disabled={events.length < 2}
                className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {at >= last ? <RotateCcw className="size-4" /> : <Play className="size-4" />} {at >= last ? "Replay" : "Play"}
              </button>
            )}
            <input
              id="pipeline-scrub"
              type="range"
              min={0}
              max={Math.max(0, last)}
              value={Math.max(0, at)}
              onChange={(e) => {
                setReplay(null);
                setPosition(Number(e.target.value));
              }}
              aria-label="Replay position"
              className="min-w-48 flex-1 accent-[var(--accent)]"
              disabled={events.length < 2}
            />
            <span className="font-mono text-xs text-muted tabular-nums">
              {events[at] ? new Date(events[at].at).toLocaleTimeString() : "–"} · event {Math.max(0, at + 1)}/{events.length}
            </span>
            {following && t.live ? (
              <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent uppercase">
                <Radio className="size-3" /> Live
              </span>
            ) : !following ? (
              <button type="button" onClick={() => choose({ run: run })} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted hover:text-foreground">
                Replay · back to {t.live ? "live" : "the end"}
              </button>
            ) : null}
          </div>

          <StageRail stages={stages} active={activeStage(stages)} />

          <section className="mt-5">
            <h2 className="mb-2 font-medium">What the author did</h2>
            {feed.length === 0 ? (
              <p className="text-sm text-muted">No pages yet at this point of the run.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {feed.map((f) => (
                  <li key={`${f.at}-${f.text}`} className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{new Date(f.at).toLocaleTimeString()}</span>
                    <span className={f.tone === "warn" ? "text-warning" : f.tone === "ok" ? "text-foreground" : "text-muted"}>{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
