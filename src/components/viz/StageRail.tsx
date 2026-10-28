import { AlertTriangle, Check, CircleSlash, Loader2, Pause, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Stage, StageStatus } from "@/jobs/stages";

const CARD: Record<StageStatus, string> = {
  waiting: "border-line opacity-60",
  running: "border-accent ring-4 ring-accent/15",
  done: "border-success/60",
  stopped: "border-warning/70",
  failed: "border-danger/70",
  skipped: "border-dashed border-line opacity-70",
};

const DOT: Record<StageStatus, string> = {
  waiting: "bg-line",
  running: "bg-accent viz-pulse",
  done: "bg-success",
  stopped: "bg-warning",
  failed: "bg-danger",
  skipped: "bg-line",
};

const LABEL: Record<StageStatus, { text: string; icon: ReactNode }> = {
  waiting: { text: "waiting", icon: null },
  running: { text: "running", icon: <Loader2 className="size-3 animate-spin motion-reduce:animate-none" /> },
  done: { text: "done", icon: <Check className="size-3" /> },
  stopped: { text: "stopped", icon: <Pause className="size-3" /> },
  failed: { text: "failed", icon: <X className="size-3" /> },
  skipped: { text: "skipped", icon: <CircleSlash className="size-3" /> },
};

const NOTE_SPAN = 5;

/**
 * The pipeline as objects on a board. Sized by its container, not the window, because the chat
 * panel shares the screen: wide boards get one row with a margin note under the active stage,
 * narrower ones a vertical list where the active stage carries its own note.
 */
export function StageRail({ stages, active }: { stages: Stage[]; active: number }) {
  const total = stages.length * 2 - 1;
  const col = active * 2 + 1;
  const style = { "--note-col": `${Math.min(col, total - NOTE_SPAN + 1)} / span ${NOTE_SPAN}`, "--leader-col": `${col}` } as CSSProperties;
  const focus = stages[active];

  return (
    <div className="board @container rounded-xl border border-line p-4">
      <div
        className="grid grid-cols-1 @min-[1040px]:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)] @min-[1040px]:gap-y-3"
        style={style}
      >
        {stages.flatMap((stage, i) => {
          const card = <StageCard key={stage.id} stage={stage} index={i} note={i === active} />;
          if (i === stages.length - 1) return [card];
          const next = stages[i + 1].status;
          return [card, <Wire key={`${stage.id}-wire`} state={next === "running" ? "on" : next === "waiting" ? "off" : "done"} />];
        })}
        <div aria-hidden className="hidden h-5 justify-self-center border-l-[1.5px] border-dashed border-muted/60 @min-[1040px]:row-start-2 @min-[1040px]:block @min-[1040px]:[grid-column:var(--leader-col)]" />
        <div className="hidden rounded-lg border border-line bg-surface p-3 @min-[1040px]:row-start-3 @min-[1040px]:block @min-[1040px]:[grid-column:var(--note-col)]" aria-live="polite">
          <p className="text-sm font-medium">{focus.name}</p>
          <p className="mt-1 text-sm text-muted">{focus.note}</p>
        </div>
      </div>
    </div>
  );
}

function StageCard({ stage, index, note }: { stage: Stage; index: number; note: boolean }) {
  const label = LABEL[stage.status];
  return (
    <div
      className={`grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg border-[1.5px] bg-surface p-3 transition @min-[1040px]:row-start-1 @min-[1040px]:flex @min-[1040px]:min-h-36 @min-[1040px]:flex-col @min-[1040px]:gap-1.5 ${CARD[stage.status]}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className={`size-2 shrink-0 rounded-full ${DOT[stage.status]}`} />
          <span className="min-w-0 @min-[1040px]:truncate" title={stage.name}>
            <span className="text-muted">{index + 1}.</span> {stage.name}
          </span>
        </div>
        <span className="flex items-center gap-1 text-[11px] tracking-wide text-muted uppercase @min-[1040px]:order-last">
          {label.icon}
          {label.text}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 @min-[1040px]:flex-1">
        <div className="font-mono text-xl tabular-nums">{stage.value}</div>
        <div className="text-xs break-words text-muted">{stage.detail}</div>
        {stage.warnings.map((w) => (
          <span key={w} className="flex w-fit items-start gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning" title={w}>
            <AlertTriangle className="mt-px size-3 shrink-0" />
            <span className="break-words @min-[1040px]:line-clamp-2">{w}</span>
          </span>
        ))}
      </div>
      {note && (
        <p className="col-span-2 mt-2 border-t border-dashed border-line pt-2 text-sm text-muted @min-[1040px]:hidden" aria-live="polite">
          {stage.note}
        </p>
      )}
    </div>
  );
}

/** A connector; while the next stage runs, a packet travels along it. Down in the list, across in the row. */
function Wire({ state }: { state: "off" | "on" | "done" }) {
  const stroke = state === "on" ? "var(--accent)" : state === "done" ? "var(--success)" : "var(--line)";
  const across = "M2,20 C14,14 26,26 34,20";
  const down = "M12,1 L12,21";
  return (
    <>
      <svg aria-hidden viewBox="0 0 24 28" className="ml-5 h-7 w-6 @min-[1040px]:hidden">
        <path d={down} fill="none" stroke={stroke} strokeWidth={1.5} />
        <path d="M8,20 L12,27 L16,20 Z" fill={stroke} />
        {state === "on" && <Packet path={down} />}
      </svg>
      <svg aria-hidden viewBox="0 0 40 40" className="hidden h-10 w-10 self-start @min-[1040px]:row-start-1 @min-[1040px]:mt-6 @min-[1040px]:block">
        <path d={across} fill="none" stroke={stroke} strokeWidth={1.5} />
        <path d="M31,16 L38,20 L31,24 Z" fill={stroke} />
        {state === "on" && <Packet path={across} />}
      </svg>
    </>
  );
}

function Packet({ path }: { path: string }) {
  return (
    <circle r={3} fill="var(--accent)" className="viz-packet">
      <animateMotion dur="0.9s" repeatCount="indefinite" path={path} />
    </circle>
  );
}
