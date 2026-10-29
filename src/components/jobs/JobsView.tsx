"use client";

import { useQuery } from "@tanstack/react-query";
import { jobsOverviewSchema } from "@/core/api-schemas";
import type { JobsOverview } from "@/jobs/overview";
import { fetchJson } from "@/lib/fetch-json";
import { useWiki } from "@/components/wikis/WikiContext";
import { queryKeys } from "@/lib/query-keys";
import { apiBase } from "@/wiki/routes";
import { PipelineCard } from "./PipelineCard";

const BUSY_POLL_MS = 3000;
const IDLE_POLL_MS = 15000;
/** Ids and shas say nothing at a glance; everything else in a log entry is worth a word. */
const HIDDEN_DETAILS = new Set(["runId", "pageId", "parentId", "revisionId", "fromSha", "toSha"]);
const MAX_DETAIL = 80;

const fetchOverview = (slug: string) => fetchJson(`${apiBase(slug)}/jobs`, jobsOverviewSchema);

const isBusy = (o: JobsOverview) =>
  o.pipelines.some((p) => p.sync.state === "running" || p.sync.state === "waiting" || p.author.state === "running" || p.author.state === "waiting") ||
  o.jobs.some((j) => j.state === "created" || j.state === "active" || j.state === "retry") ||
  o.runs.some((r) => r.status === "running");

export function JobsView({ initial }: { initial: JobsOverview }) {
  const { slug } = useWiki();
  const overview = useQuery({
    queryKey: queryKeys.jobs.overview(slug),
    queryFn: () => fetchOverview(slug),
    initialData: initial,
    refetchInterval: (q) => (q.state.data && isBusy(q.state.data) ? BUSY_POLL_MS : IDLE_POLL_MS),
  });
  const o = overview.data;
  const now = Date.parse(o.asOf);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Each repository goes through sync, then the author agent, then your review. Refreshed live. Total model spend:{" "}
        <strong>{usd(o.totalCostUsd)}</strong>
      </p>
      {overview.error && <p className="mb-4 text-sm text-danger">{overview.error.message}</p>}

      <section className="mb-6">
        <h2 className="mb-2 font-medium">Pipeline</h2>
        {o.pipelines.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">No repositories yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {o.pipelines.map((p) => (
              <PipelineCard key={p.repoId} p={p} now={now} format={{ usd, tokens, duration }} />
            ))}
          </ul>
        )}
      </section>

      <Section title="Agent runs" empty={o.runs.length === 0}>
        {o.runs.map((r) => (
          <Row
            key={r.id}
            badge={r.status}
            main={`${r.kind}${r.repo ? ` · ${r.repo}` : ""} · ${r.model}`}
            meta={`${tokens(r.inputTokens)} in · ${tokens(r.outputTokens)} out · ${usd(r.costUsd)} · ${duration(r.startedAt, r.finishedAt, now)}`}
            error={r.error}
          />
        ))}
      </Section>

      <Section title="Queue" empty={o.jobs.length === 0}>
        {o.jobs.map((j) => (
          <Row
            key={j.id}
            badge={j.state}
            main={j.repo ? `${j.name} · ${j.repo}` : j.name}
            meta={`${ago(j.createdOn, now)}${j.startedOn ? ` · ran ${duration(j.startedOn, j.completedOn, now)}` : ""}${j.retryCount ? ` · retry ${j.retryCount}` : ""}`}
            error={j.error}
          />
        ))}
      </Section>

      <Section title="Activity" empty={o.activity.length === 0}>
        {o.activity.map((a, i) => (
          <Row key={`${a.at}-${i}`} badge={a.action} main={a.repo ?? "wiki"} meta={`${ago(a.at, now)} ${summarize(a.details)}`} />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-medium">{title}</h2>
      {empty ? (
        <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">{children}</ul>
      )}
    </section>
  );
}

function Row({ badge, main, meta, error }: { badge: string; main: string; meta: string; error?: string | null }) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 font-mono text-xs ${badgeTone(badge)}`}>{badge}</span>
        <span className="min-w-0 font-medium break-words">{main}</span>
      </div>
      <p className="text-xs break-words text-muted">{meta}</p>
      {error && <p className="text-xs break-words text-danger">{error}</p>}
    </li>
  );
}

function badgeTone(state: string): string {
  if (["failed", "error", "cancelled"].includes(state)) return "bg-danger/15 text-danger";
  if (["active", "running", "syncing", "retry"].includes(state)) return "bg-accent/15 text-accent";
  if (["completed", "succeeded", "idle"].includes(state)) return "bg-success/15 text-success";
  return "bg-line text-muted";
}

function summarize(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const parts = Object.entries(details)
    .filter(([k, v]) => !HIDDEN_DETAILS.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : typeof v === "object" ? "…" : clip(String(v))}`);
  return parts.length ? `· ${parts.join(", ")}` : "";
}

const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}…` : s);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function duration(from: string, to: string | null, now: number): string {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
  const text = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return to ? text : `${text} so far`;
}

function ago(at: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
