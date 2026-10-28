import { describe, expect, it } from "vitest";
import { activeStage, deriveStages, type TimelineEvent } from "./stages";
import { splitRuns } from "./timeline";

let clock = 0;
const ev = (action: string, details: Record<string, unknown> = {}): TimelineEvent => ({
  at: new Date(Date.UTC(2026, 9, 28, 12, 0, clock++)).toISOString(),
  action,
  details,
});

const A = "a".repeat(40);
const B = "b".repeat(40);

function fullRun(): TimelineEvent[] {
  return [
    ev("sync.started", { syncId: "s1", fromSha: A, toSha: B, mode: "incremental" }),
    ev("sync.progress", { syncId: "s1", stage: "files", downloaded: 12, kept: 9, dropped: 3, secrets: 1 }),
    ev("sync.progress", { syncId: "s1", stage: "index", done: 0, total: 9, indexed: 0, embedded: 0, failed: 0 }),
    ev("sync.progress", { syncId: "s1", stage: "index", done: 9, total: 9, indexed: 9, embedded: 40, failed: 0 }),
    ev("repo.synced", { syncId: "s1", fromSha: A, toSha: B, embedded: 40, chunksKept: 100, indexed: 9, changedPaths: 9 }),
    ev("author.started", { runId: "r1", tokens: 0, costUsd: 0 }),
    ev("author.outline", { runId: "r1", planned: 3, tokens: 1000, costUsd: 0.001 }),
    ev("author.page_started", { runId: "r1", path: "Overview" }),
    ev("author.page_proposed", { runId: "r1", path: "Overview", citations: 4, ungrounded: 1, tokens: 5000, costUsd: 0.01 }),
    ev("author.page_started", { runId: "r1", path: "Glossary" }),
    ev("author.page_dropped", { runId: "r1", path: "Glossary", reason: "the draft cited no retrieved source", tokens: 8000, costUsd: 0.02 }),
    ev("author.finished", { runId: "r1", status: "budget_exceeded", proposed: 1, skipped: 0, tokens: 9000, costUsd: 0.021 }),
  ];
}

const byId = (events: TimelineEvent[], opts = { ongoing: false, pendingReview: null as number | null }) =>
  Object.fromEntries(deriveStages(events, opts).stages.map((s) => [s.id, s]));

describe("deriveStages", () => {
  it("shows a finished run, with problems at the stage where they happened", () => {
    const s = byId(fullRun());
    expect(s.poll).toMatchObject({ status: "done", detail: "aaaaaaa → bbbbbbb" });
    expect(s.download).toMatchObject({ status: "done", value: "12" });
    expect(s.filter).toMatchObject({ status: "done", value: "9" });
    expect(s.filter.warnings).toEqual(["1 file(s) held a secret and were dropped"]);
    expect(s.index).toMatchObject({ status: "done", value: "40" });
    expect(s.author).toMatchObject({ status: "stopped", value: "1/3" });
    expect(s.author.detail).toContain("9,000 tokens · $0.021");
    expect(s.author.warnings).toEqual([
      "1 dropped: the draft cited no retrieved source",
      "1 invented citation(s) stripped",
      "stopped: the run's token budget was reached",
    ]);
    expect(s.review).toMatchObject({ status: "done", value: "1" });
  });

  it("a replay prefix shows the stage that was running at that moment", () => {
    const prefix = fullRun().slice(0, 3);
    const s = byId(prefix, { ongoing: true, pendingReview: null });
    expect(s.index).toMatchObject({ status: "running", detail: "chunks embedded · 0/9 files" });
    expect(s.author.status).toBe("waiting");
    expect(activeStage(deriveStages(prefix, { ongoing: true, pendingReview: null }).stages)).toBe(3);
  });

  it("names the page being written while the author runs", () => {
    const s = byId(fullRun().slice(0, 10), { ongoing: true, pendingReview: 5 });
    expect(s.author).toMatchObject({ status: "running", detail: "writing Glossary" });
    expect(s.review.detail).toBe("proposals · 5 waiting for you now");
  });

  it("marks a failed sync at the stage it reached", () => {
    const events = [ev("sync.started", { syncId: "s2", fromSha: null, toSha: B }), ev("sync.failed", { syncId: "s2", error: "GitHub 404" })];
    const s = byId(events);
    expect(s.download).toMatchObject({ status: "failed", warnings: ["GitHub 404"] });
    expect(s.index.status).toBe("waiting");
  });

  it("reads a run logged before progress events from repo.synced alone", () => {
    const legacy = [ev("repo.synced", { fromSha: null, toSha: B, mode: "full", dropped: 4, secretsDropped: [], embedded: 50, indexed: 10, changedPaths: 0 })];
    const s = byId(legacy);
    expect(s.poll.value).toBe("first sync");
    expect(s.download).toMatchObject({ status: "done", detail: "recorded before progress events" });
    expect(s.index).toMatchObject({ status: "done", value: "50" });
    expect(s.author).toMatchObject({ status: "skipped", detail: "nothing changed, nothing to write" });
  });
});

describe("splitRuns", () => {
  it("starts a run at each sync, legacy ones at repo.synced, and keeps author events with their sync", () => {
    const legacy = ev("repo.synced", { toSha: A });
    const legacyAuthor = ev("author.started", { runId: "r0" });
    const run = fullRun();
    const runs = splitRuns([legacy, legacyAuthor, ...run]);
    expect(runs.map((r) => r.events.length)).toEqual([2, run.length]);
    expect(runs[1].key).toBe(run[0].at);
  });
});
