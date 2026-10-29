import { ArrowDown, ArrowRight, Download, Eye, PenLine } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useWiki } from "@/components/wikis/WikiContext";
import type { RepoPipeline, StepState } from "@/jobs/pipeline";
import { wikiBase } from "@/wiki/routes";

const STATE_LABEL: Record<StepState, string> = {
  idle: "not started",
  waiting: "waiting",
  running: "running",
  done: "done",
  stopped: "stopped at budget",
  failed: "failed",
};

const STATE_TONE: Record<StepState, string> = {
  idle: "border-line text-muted",
  waiting: "border-line text-muted",
  running: "border-accent text-accent",
  done: "border-success/60 text-success",
  stopped: "border-danger/60 text-danger",
  failed: "border-danger text-danger",
};

/** One repo's trip through the pipeline: sync → author → review, with what each step produced. */
export function PipelineCard({ p, now, format }: { p: RepoPipeline; now: number; format: { usd: (n: number) => string; tokens: (n: number) => string; duration: (from: string, to: string | null, now: number) => string } }) {
  const { slug } = useWiki();
  const { sync, author } = p;
  const handled = author.proposed + author.dropped + author.skipped;
  const progress = author.planned ? Math.min(1, handled / author.planned) : null;
  return (
    <li className="rounded-md border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium break-all">{p.fullName}</span>
        {p.role && <span className="text-xs text-muted">{p.role}</span>}
      </div>
      <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
        <Step icon={<Download className="size-4" />} title="1 · Sync" state={sync.state}>
          {sync.indexed !== null && <p>{sync.indexed} files indexed · {sync.embedded ?? 0} chunks embedded</p>}
          {sync.secretsDropped.length > 0 && (
            <p title={sync.secretsDropped.join(", ")}>{sync.secretsDropped.length} dropped by the secret scanner</p>
          )}
          {sync.startedAt && <p>took {format.duration(sync.startedAt, sync.finishedAt, now)}</p>}
        </Step>
        <Arrow />
        <Step icon={<PenLine className="size-4" />} title="2 · Author" state={author.state}>
          {author.state === "waiting" && author.queuePosition !== null && (
            <p>{author.queuePosition === 1 ? "next in line" : `#${author.queuePosition} in line`} (one run at a time)</p>
          )}
          {author.startedAt && (
            <>
              <p>
                {author.proposed} page{author.proposed === 1 ? "" : "s"} written
                {author.planned !== null ? ` of ${author.planned} planned` : ""}
                {author.dropped > 0 ? ` · ${author.dropped} dropped` : ""}
                {author.skipped > 0 && (
                  <span title={`Left alone: ${author.skipReasons.join("; ")}`} className="underline decoration-dotted">
                    {` · ${author.skipped} skipped`}
                  </span>
                )}
              </p>
              {progress !== null && (
                <div className="my-1 h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
              {author.current && <p className="break-words">writing: {author.current}</p>}
              <p>
                {format.tokens(author.tokens)} tokens · {format.usd(author.costUsd)} · {format.duration(author.startedAt, author.finishedAt, now)}
              </p>
            </>
          )}
        </Step>
        <Arrow />
        <Step icon={<Eye className="size-4" />} title="3 · Review" state={p.pendingReview > 0 ? "waiting" : author.state === "done" || author.state === "stopped" ? "done" : "idle"}>
          {p.pendingReview > 0 ? (
            <p>
              <Link href={`${wikiBase(slug)}/proposals`} className="text-accent hover:underline">
                {p.pendingReview} proposal{p.pendingReview === 1 ? "" : "s"}
              </Link>{" "}
              cite this repo

            </p>
          ) : (
            <p>nothing to review</p>
          )}
        </Step>
      </div>
      {p.lastError && <p className="mt-2 text-xs break-words text-danger">{p.lastError}</p>}
    </li>
  );
}

function Step({ icon, title, state, children }: { icon: ReactNode; title: string; state: StepState; children: ReactNode }) {
  return (
    <div className={`min-w-0 flex-1 rounded border px-3 py-2 ${STATE_TONE[state]} ${state === "running" ? "animate-pulse" : ""}`}>
      <div className="flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
        {icon}
        {title}
      </div>
      <p className="text-xs">{STATE_LABEL[state]}</p>
      <div className="mt-1 text-xs text-muted">{children}</div>
    </div>
  );
}

function Arrow() {
  return (
    <span className="flex justify-center text-muted" aria-hidden>
      <ArrowDown className="size-4 sm:hidden" />
      <ArrowRight className="hidden size-4 sm:block" />
    </span>
  );
}
