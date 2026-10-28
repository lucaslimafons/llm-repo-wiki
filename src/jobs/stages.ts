/** Pure, client-safe: turns one run's wiki_log events into the six stages the pipeline view draws. */

export type TimelineEvent = { at: string; action: string; details: Record<string, unknown> };

export type StageId = "poll" | "download" | "filter" | "index" | "author" | "review";
export type StageStatus = "waiting" | "running" | "done" | "stopped" | "failed" | "skipped";

export type Stage = {
  id: StageId;
  name: string;
  status: StageStatus;
  /** The big number on the card. */
  value: string;
  detail: string;
  /** Problems shown where they happened. */
  warnings: string[];
  /** Plain-language note for the margin: what this stage does and why. */
  note: string;
};

export type FeedItem = { at: string; tone: "ok" | "warn" | "info"; text: string };

export const STAGE_NOTES: Record<StageId, { name: string; note: string }> = {
  poll: {
    name: "Poll",
    note: "Every few minutes the worker asks GitHub for the newest commit on the default branch. If it differs from the commit already indexed, there is work to do. A webhook can trigger the same thing.",
  },
  download: {
    name: "Download",
    note: "The repository arrives as one tarball at that exact commit, read in memory. An incremental sync downloads only the files the commit changed.",
  },
  filter: {
    name: "Filter + secret scan",
    note: "Lockfiles, images, vendored and generated files are dropped. Files that look like they contain a secret are dropped too, so a leaked key never becomes searchable.",
  },
  index: {
    name: "Chunk + embed",
    note: "Each file is cut at functions and headings. Each chunk gets an embedding (numbers for its meaning, for vector search) and a full-text index (its words). Chunks that did not change keep their old embedding.",
  },
  author: {
    name: "Author pages",
    note: "The model plans an outline. For each page the job searches the chunks, the model writes a draft from that evidence only, and any citation that points at nothing retrieved is stripped.",
  },
  review: {
    name: "Review",
    note: "Nothing is published on its own. Every page is a proposal you accept or reject on the Proposals page.",
  },
};

const ORDER: StageId[] = ["poll", "download", "filter", "index", "author", "review"];
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const short = (sha: unknown) => (typeof sha === "string" ? sha.slice(0, 7) : null);
const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

/**
 * `events` are the run's events up to the moment being shown: everything for live, a prefix for
 * replay. `ongoing` (live, or mid-replay) decides whether an unfinished stage is running or was cut off.
 */
export function deriveStages(events: TimelineEvent[], opts: { ongoing: boolean; pendingReview: number | null }): { stages: Stage[]; feed: FeedItem[] } {
  const find = (action: string) => events.findLast((e) => e.action === action);
  const started = find("sync.started");
  const files = events.findLast((e) => e.action === "sync.progress" && e.details.stage === "files");
  const index = events.findLast((e) => e.action === "sync.progress" && e.details.stage === "index");
  const synced = find("repo.synced");
  const syncFailed = find("sync.failed");
  const authorStarted = find("author.started");
  const outline = find("author.outline");
  const finished = find("author.finished");
  const authorFailed = find("author.failed");
  const anchor = started ?? synced;
  const cut: StageStatus = opts.ongoing ? "running" : "stopped";

  const base = (id: StageId): Stage => ({ id, ...STAGE_NOTES[id], status: "waiting", value: "–", detail: "waiting", warnings: [] });
  const s = Object.fromEntries(ORDER.map((id) => [id, base(id)])) as Record<StageId, Stage>;
  if (!anchor) return { stages: ORDER.map((id) => s[id]), feed: [] };

  // Poll
  const from = short(anchor.details.fromSha);
  s.poll.status = "done";
  s.poll.value = from ? "new commit" : "first sync";
  s.poll.detail = from ? `${from} → ${short(anchor.details.toSha)}` : `at ${short(anchor.details.toSha)}`;

  // Download + filter. Runs recorded before progress events only have the final summary.
  const legacy = !started;
  if (files) {
    s.download.status = "done";
    s.download.value = fmt(num(files.details.downloaded));
    s.download.detail = `files (${String(anchor.details.mode ?? "full")} sync)`;
    s.filter.status = "done";
    s.filter.value = fmt(num(files.details.kept));
    s.filter.detail = `kept · ${fmt(num(files.details.dropped))} dropped`;
    if (num(files.details.secrets)) s.filter.warnings.push(`${num(files.details.secrets)} file(s) held a secret and were dropped`);
  } else if (legacy && synced) {
    s.download.status = "done";
    s.download.value = String(synced.details.mode ?? "full");
    s.download.detail = "recorded before progress events";
    s.filter.status = "done";
    s.filter.value = fmt(num(synced.details.dropped));
    s.filter.detail = "dropped";
    const secrets = Array.isArray(synced.details.secretsDropped) ? synced.details.secretsDropped.length : 0;
    if (secrets) s.filter.warnings.push(`${secrets} file(s) held a secret and were dropped`);
  } else {
    s.download.status = syncFailed ? "failed" : cut;
    s.download.detail = "downloading the tarball";
  }

  // Chunk + embed
  if (synced) {
    s.index.status = "done";
    s.index.value = fmt(num(synced.details.embedded));
    s.index.detail = `chunks embedded · ${fmt(num(synced.details.chunksKept))} kept · ${fmt(num(synced.details.indexed))} files`;
  } else if (index) {
    s.index.status = syncFailed ? "failed" : cut;
    s.index.value = fmt(num(index.details.embedded));
    s.index.detail = `chunks embedded · ${fmt(num(index.details.done))}/${fmt(num(index.details.total))} files`;
  }
  if (num(index?.details.failed)) s.index.warnings.push(`${num(index?.details.failed)} file(s) failed`);
  if (syncFailed) {
    const at = !files && !legacy ? s.download : s.index;
    at.status = "failed";
    at.warnings.push(String(syncFailed.details.error ?? "sync failed"));
  }

  // Author
  const pages = events.filter((e) => e.action.startsWith("author.page_"));
  const proposed = pages.filter((e) => e.action === "author.page_proposed");
  const dropped = pages.filter((e) => e.action === "author.page_dropped");
  const skipped = pages.filter((e) => e.action === "author.page_skipped");
  const stripped = proposed.reduce((n, e) => n + num(e.details.ungrounded), 0);
  const last = [...pages, ...(finished ? [finished] : [])].at(-1) ?? authorStarted;
  const planned = outline ? num(outline.details.planned) : null;
  if (authorStarted) {
    // Runs older than the outline event only know what they proposed.
    s.author.value = planned !== null ? `${proposed.length}/${planned}` : finished || authorFailed ? String(proposed.length) : "planning";
    // Spend rides on run events since this view shipped; older runs simply don't show it.
    const spent = typeof last?.details.tokens === "number" ? ` · ${fmt(num(last.details.tokens))} tokens · ${usd(num(last.details.costUsd))}` : "";
    s.author.detail = `pages${spent}`;
    if (dropped.length) s.author.warnings.push(`${dropped.length} dropped: ${String(dropped.at(-1)!.details.reason)}`);
    if (stripped) s.author.warnings.push(`${stripped} invented citation(s) stripped`);
    if (finished) {
      const budget = finished.details.status === "budget_exceeded";
      s.author.status = budget ? "stopped" : "done";
      if (budget) s.author.warnings.push("stopped: the run's token budget was reached");
      if (skipped.length) s.author.detail += ` · ${skipped.length} skipped`;
    } else if (authorFailed) {
      s.author.status = "failed";
      s.author.warnings.push(String(authorFailed.details.error ?? "author failed"));
    } else {
      s.author.status = cut;
      const current = events.findLast((e) => e.action === "author.page_started");
      const settled = current && pages.some((e) => e !== current && e.details.path === current.details.path && e.at >= current.at);
      if (current && !settled) s.author.detail = `writing ${String(current.details.path)}`;
    }
  } else if (synced) {
    if (num(synced.details.changedPaths) === 0) {
      s.author.status = "skipped";
      s.author.value = "–";
      s.author.detail = "nothing changed, nothing to write";
    } else {
      s.author.status = opts.ongoing ? "waiting" : "stopped";
      s.author.detail = "queued behind other repos";
    }
  }

  // Review
  if (finished || (authorStarted && proposed.length)) {
    s.review.status = finished ? "done" : "waiting";
    s.review.value = fmt(proposed.length);
    s.review.detail = opts.pendingReview === null ? "proposals from this run" : `proposals · ${fmt(opts.pendingReview)} waiting for you now`;
  }

  const feed: FeedItem[] = [];
  for (const e of events) {
    const path = String(e.details.path ?? "");
    if (e.action === "author.page_proposed")
      feed.push({ at: e.at, tone: "ok", text: `Proposed ${path} · ${num(e.details.citations)} citations${num(e.details.ungrounded) ? `, ${num(e.details.ungrounded)} stripped` : ""}` });
    else if (e.action === "author.page_dropped") feed.push({ at: e.at, tone: "warn", text: `Dropped ${path}: ${String(e.details.reason)}` });
    else if (e.action === "author.page_skipped") feed.push({ at: e.at, tone: "info", text: `Skipped ${path}: ${String(e.details.reason)}` });
    else if (e.action === "sync.failed" || e.action === "author.failed") feed.push({ at: e.at, tone: "warn", text: String(e.details.error) });
  }
  return { stages: ORDER.map((id) => s[id]), feed: feed.slice(-8).reverse() };
}

/** The stage the margin note points at: the running one, else the last that did anything. */
export function activeStage(stages: Stage[]): number {
  const running = stages.findIndex((s) => s.status === "running" || s.status === "failed");
  if (running !== -1) return running;
  const lastTouched = stages.findLastIndex((s) => s.status !== "waiting");
  return Math.max(0, lastTouched);
}
