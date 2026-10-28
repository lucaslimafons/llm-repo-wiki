"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Equal, Loader2, PinOff, Search, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { MAX_ANSWER_CHUNKS } from "@/search/constants";
import { explainAnswerSchema, searchExplanationSchema } from "@/core/api-schemas";
import { Markdown } from "@/components/markdown/Markdown";
import { fetchJson } from "@/lib/fetch-json";
import { queryKeys } from "@/lib/query-keys";
import type { ExplainItem, SearchExplanation } from "@/search/explain";

/** Fixed geometry: rows never measure the DOM, so the lines between lists are plain arithmetic. */
const ROW = 56;
const GAP = 8;
const HEAD = 40;
const GUTTER = 40;
const rowY = (i: number) => HEAD + i * (ROW + GAP) + ROW / 2;

const STEPS = [
  "One question, two searches",
  "Full-text search finds the words",
  "Vector search finds the meaning",
  "Fusion merges the two by rank",
  "A reranker reads them again (optional)",
  "The answer, and which citations survive",
] as const;

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const fetchExplain = (query: string, rerank: boolean) => fetchJson("/api/explain", searchExplanationSchema, post({ query, rerank }));

const label = (i: ExplainItem) => (i.hit.kind === "source" ? `${i.hit.path}#L${i.hit.startLine}-L${i.hit.endLine}` : `wiki: ${i.hit.pagePath}`);
/** The file or page name: what a reader recognizes in a narrow row. */
const shortName = (i: ExplainItem) => (i.hit.kind === "source" ? i.hit.path : i.hit.pagePath).split("/").at(-1) ?? "";
const where = (i: ExplainItem) => (i.hit.kind === "source" ? `L${i.hit.startLine}-${i.hit.endLine}` : "wiki");
const origin = (i: ExplainItem) =>
  i.hit.kind === "source" ? `${i.hit.repo}${i.hit.symbol ? ` · ${i.hit.symbol}` : ""}` : (i.hit.headingPath ?? "wiki page");
const rrfTerm = (k: number, r: number | null) => (r === null ? null : `1/(${k}+${r})`);

export function ExplainView({ initialQuery }: { initialQuery: string }) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [step, setStep] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const search = useQuery({
    queryKey: queryKeys.explain.search(query),
    queryFn: () => fetchExplain(query, false),
    enabled: query.length > 0,
    staleTime: Infinity,
  });
  // Paid and optional: its own request, so a failure stays in the rerank panel instead of blanking the board.
  const rerank = useMutation({ mutationFn: () => fetchExplain(query, true) });
  const answer = useMutation({
    mutationFn: (keys: string[]) => fetchJson("/api/explain/answer", explainAnswerSchema, post({ query, keys })),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim().slice(0, 500);
    if (!q) return;
    setQuery(q);
    rerank.reset();
    setStep(0);
    setPinned(null);
    answer.reset();
    window.history.replaceState(null, "", `/explain?q=${encodeURIComponent(q)}`);
  };

  const x = rerank.data ?? search.data;
  // A clicked chunk stays put: scrolling to its details must not let hover swap it out.
  const focus = pinned ?? hover;
  const answerList = x ? (x.reranked?.items ?? x.fused).slice(0, MAX_ANSWER_CHUNKS) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">How an answer is found</h1>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-muted">
        Ask a question about your repositories and step through retrieval with the real data: the two searches, how their lists are fused, and which
        citations in the answer survive the grounding check.
      </p>

      <form onSubmit={submit} className="mb-5 flex max-w-3xl gap-2">
        <input
          id="explain-query"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. How is a recipe saved offline?"
          maxLength={500}
          className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm"
        />
        <button type="submit" className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
          <Search className="size-4" /> Explain
        </button>
      </form>

      {search.error && <p className="mb-4 text-sm text-danger">{search.error.message}</p>}
      {!query ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          Type a question to begin. Chat answers also link here: open a search step in a chat and choose “How was this found?”.
        </p>
      ) : !x ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Searching…
        </p>
      ) : (
        <>
          <Stepper step={step} setStep={setStep} />
          <div className="board overflow-x-auto rounded-xl border border-line p-5">
            <QueryCard x={x} />
            <Note x={x} step={step} />
            {step === 4 && <RerankPanel x={x} loading={rerank.isPending} error={rerank.error} onRerank={() => rerank.mutate()} />}
            {step === 5 && (
              <AnswerPanel
                count={answerList.length}
                reranked={!!x.reranked}
                state={answer}
                onGenerate={() => answer.mutate(answerList.map((i) => i.key))}
              />
            )}
            <div className="mt-6">
              <Lists x={x} step={step} focus={focus} setHover={setHover} pinned={pinned} setPinned={setPinned} />
            </div>
          </div>
          {focus && step >= 1 && <Detail x={x} itemKey={focus} pinned={pinned !== null} onUnpin={() => setPinned(null)} />}
        </>
      )}
    </div>
  );
}

function Stepper({ step, setStep }: { step: number; setStep: (n: number) => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setStep(step - 1)} disabled={step === 0} className="flex items-center gap-1 rounded border border-line bg-surface px-3 py-1 text-sm disabled:opacity-40">
        <ChevronLeft className="size-4" /> Back
      </button>
      <button
        type="button"
        onClick={() => setStep(step + 1)}
        disabled={step === STEPS.length - 1}
        className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-40"
      >
        Next <ChevronRight className="size-4" />
      </button>
      <ol className="flex gap-1" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              title={s}
              className={`block h-1.5 w-7 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`}
            >
              <span className="sr-only">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <span className="text-sm text-muted">
        Step {step + 1} of {STEPS.length}: <span className="text-foreground">{STEPS[step]}</span>
      </span>
    </div>
  );
}

function QueryCard({ x }: { x: SearchExplanation }) {
  return (
    <div className="mb-5 grid max-w-4xl gap-3 rounded-lg border-[1.5px] border-line bg-surface p-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Question</p>
        <p className="font-medium">{x.query}</p>
      </div>
      <div className="min-w-0 rounded bg-surface-2 p-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Full-text query</p>
        <p className="font-mono text-xs break-words">{x.tsquery || "(no searchable words)"}</p>
        <p className="mt-1 text-xs text-muted">{x.candidates.fts} chunks matched</p>
      </div>
      <div className="min-w-0 rounded bg-surface-2 p-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Embedding</p>
        <p className="font-mono text-xs break-words">
          {x.embedding ? `[${x.embedding.preview.join(", ")}, …] ${x.embedding.dims} numbers` : "–"}
        </p>
        <p className="mt-1 text-xs text-muted">{x.embedding?.model} · {x.candidates.vector} nearest chunks</p>
      </div>
    </div>
  );
}

type ListProps = {
  x: SearchExplanation;
  step: number;
  focus: string | null;
  setHover: (k: string | null) => void;
  pinned: string | null;
  setPinned: (k: string | null) => void;
};

function Lists({ x, step, focus, setHover, pinned, setPinned }: ListProps) {
  if (step < 1) return null;
  const showVec = step >= 2;
  const showFused = step >= 3;
  const height = HEAD + Math.max(x.fts.length, x.vector.length, x.fused.length) * (ROW + GAP);
  const row = (i: ExplainItem, rank: number | null, sub: string) => (
    <Row key={i.key} item={i} rank={rank} sub={sub} focus={focus} pinned={pinned === i.key} setHover={setHover} setPinned={setPinned} />
  );

  return (
    <div
      className="grid min-w-[600px] grid-cols-[minmax(0,1fr)_var(--gutter)_minmax(0,1.3fr)_var(--gutter)_minmax(0,1fr)]"
      style={{ "--gutter": `${GUTTER}px` } as React.CSSProperties}
      onMouseLeave={() => setHover(null)}
    >
      <Column title="Full-text" hint="words · ts_rank">
        {x.fts.map((i) => row(i, i.ftsRank, `${where(i)} · ${(i.ftsScore ?? 0).toFixed(3)}`))}
      </Column>
      <Gutter show={showFused} height={height} links={links(x, "fts")} focus={focus} color="var(--accent)" key={`l-${step >= 3}`} />
      <Column title="Fused" hint={`RRF, k = ${x.rrfK}`} muted={!showFused}>
        {showFused ? (
          x.fused.map((i) => row(i, i.fusedRank, `text ${i.ftsRank ? `#${i.ftsRank}` : "–"} · vector ${i.vecRank ? `#${i.vecRank}` : "–"}`))
        ) : (
          <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">The fused list appears in step 4.</p>
        )}
      </Column>
      <Gutter show={showFused && showVec} height={height} links={links(x, "vector")} focus={focus} color="var(--warning)" mirror key={`r-${step >= 3}`} />
      <Column title="Vector" hint="meaning · cosine" muted={!showVec}>
        {showVec ? (
          x.vector.map((i) => row(i, i.vecRank, `${where(i)} · ${(i.vecSimilarity ?? 0).toFixed(3)}`))
        ) : (
          <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">The vector list appears in step 3.</p>
        )}
      </Column>
    </div>
  );
}

function Column({ title, hint, muted, children }: { title: string; hint: string; muted?: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${muted ? "opacity-70" : ""}`}>
      <div className="flex h-8 items-end justify-between gap-2 text-sm font-medium">
        <span className="truncate">{title}</span>
        <span className="truncate font-mono text-[11px] font-normal text-muted">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Row(props: {
  item: ExplainItem;
  rank: number | null;
  sub: string;
  focus: string | null;
  pinned: boolean;
  setHover: (k: string | null) => void;
  setPinned: (k: string | null) => void;
}) {
  const { item, focus } = props;
  const both = item.ftsRank !== null && item.vecRank !== null;
  const lit = focus === item.key;
  return (
    <button
      type="button"
      style={{ height: ROW }}
      onMouseEnter={() => props.setHover(item.key)}
      onFocus={() => props.setHover(item.key)}
      onBlur={() => props.setHover(null)}
      onClick={() => props.setPinned(props.pinned ? null : item.key)}
      aria-pressed={props.pinned}
      title={`${label(item)}\n${origin(item)}`}
      className={`grid shrink-0 grid-cols-[1.75rem_minmax(0,1fr)] content-center gap-x-1 rounded-lg border-[1.5px] bg-surface px-2 text-left transition ${
        lit ? "border-accent ring-4 ring-accent/15" : both ? "border-success/50" : "border-line"
      } ${focus && !lit ? "opacity-40" : ""}`}
    >
      <span className="row-span-2 self-center font-mono text-xs text-muted">#{props.rank ?? "–"}</span>
      <span className="truncate font-mono text-xs">{shortName(item)}</span>
      <span className="truncate font-mono text-[11px] text-muted tabular-nums">{props.sub}</span>
    </button>
  );
}

type Link = { key: string; from: number; to: number };

/** For each fused row, where it sat in one input list (both indexes are positions on screen). */
function links(x: SearchExplanation, list: "fts" | "vector"): Link[] {
  const source = list === "fts" ? x.fts : x.vector;
  const at = new Map(source.map((i, n) => [i.key, n]));
  return x.fused.flatMap((i, n) => (at.has(i.key) ? [{ key: i.key, from: at.get(i.key)!, to: n }] : []));
}

function Gutter(props: { show: boolean; height: number; links: Link[]; focus: string | null; color: string; mirror?: boolean }) {
  const { height, focus } = props;
  return (
    // Inline size: Tailwind's base `svg { height: auto }` would shrink a viewBox-less svg to 150px and clip the lines.
    <svg aria-hidden width={GUTTER} height={height} style={{ width: GUTTER, height }} className="overflow-visible">
      {props.show &&
        props.links.map((l) => {
          const [y1, y2] = props.mirror ? [rowY(l.to), rowY(l.from)] : [rowY(l.from), rowY(l.to)];
          const faded = focus !== null && focus !== l.key;
          // Upper bound of the curve's length: enough for the dash to cover it, close enough to time the draw.
          const len = Math.ceil(Math.abs(y2 - y1) + GUTTER);
          return (
            <path
              key={l.key}
              d={`M2,${y1} C${GUTTER / 2},${y1} ${GUTTER / 2},${y2} ${GUTTER - 2},${y2}`}
              fill="none"
              stroke={props.color}
              strokeWidth={focus === l.key ? 2.5 : 1.5}
              opacity={faded ? 0.12 : 0.9}
              className="viz-draw"
              style={{ "--len": `${len}px` } as React.CSSProperties}
            />
          );
        })}
    </svg>
  );
}

function Note({ x, step }: { x: SearchExplanation; step: number }) {
  const climber = x.fused
    .filter((i) => i.ftsRank !== null && i.vecRank !== null)
    .map((i) => ({ i, rise: Math.max(i.ftsRank!, i.vecRank!) - i.fusedRank }))
    .sort((a, b) => b.rise - a.rise)[0];
  const top = x.fused[0];
  const text = [
    `The question is turned into two queries. Full-text search keeps the meaningful words and matches them exactly. Vector search turns the question into ${x.embedding?.dims ?? "many"} numbers that capture its meaning and looks for the nearest chunks. Both run over every indexed chunk at once.`,
    `Postgres full-text search ranks chunks that contain the query words (ts_rank). It is precise for names like functions and files, but it misses synonyms: a chunk that says "persist" will not match "save".`,
    `pgvector ranks chunks by how close their embedding is to the question's (cosine similarity). It finds chunks that mean the same thing in other words, but it can rank a vaguely related chunk high. The two lists rarely agree, which is why both are used.`,
    `Reciprocal Rank Fusion gives every chunk 1/(${x.rrfK} + its rank) from each list it appears in, and adds them up. The raw scores are on different scales, so only the rank counts. A chunk both searches found gets two shares and rises.${
      climber && climber.rise > 0
        ? ` Here ${label(climber.i)} was #${Math.max(climber.i.ftsRank!, climber.i.vecRank!)} in one list and is #${climber.i.fusedRank} after fusion.`
        : ""
    } Green outlines mark chunks both lists found; hover one to follow it, click it to keep it selected.`,
    `A reranker is a second model that reads the question and each chunk together, which is slower but more precise than comparing embeddings. In this project's eval, adding it raised recall@5 from 0.80 to 0.95. It is optional here because it is one paid call.`,
    `The model now answers from the top ${MAX_ANSWER_CHUNKS} chunks${x.reranked ? " after reranking" : ""} and must cite them. Then the same grounding check the wiki author uses runs: a citation pointing at lines the model was not given is stripped, so invented sources never render as links.${
      top ? ` The best chunk is ${label(top)}.` : ""
    }`,
  ][step];
  return (
    <div className="max-w-3xl rounded-lg border border-line bg-surface p-3" aria-live="polite">
      <p className="text-sm font-medium">{STEPS[step]}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  );
}

function RerankPanel({ x, loading, error, onRerank }: { x: SearchExplanation; loading: boolean; error: Error | null; onRerank: () => void }) {
  if (!x.rerankAvailable)
    return (
      <p className="mt-4 max-w-3xl rounded-lg border border-dashed border-line bg-surface p-3 text-sm text-muted">
        Rerank is off here. OPENROUTER_ZDR keeps your code on providers that store nothing, and every rerank model on OpenRouter runs on a provider
        endpoint without that guarantee. The fused list above is what search uses today.
      </p>
    );
  if (!x.reranked)
    return (
      <div className="mt-4">
        {error && <p className="mb-2 text-sm break-words text-danger">{error.message}</p>}
        <button
          type="button"
          onClick={onRerank}
          disabled={loading}
          className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Rerank the top 30 (one paid call)
        </button>
      </div>
    );
  return (
    <div className="mt-4 max-w-3xl">
      <p className="mb-2 text-sm text-muted">
        Reranked by {x.reranked.model} · ${x.reranked.costUsd.toFixed(4)}. Arrows compare with the fused order.
      </p>
      <ol className="flex flex-col gap-1.5">
        {x.reranked.items.map((i, n) => {
          const move = i.fusedRank - (n + 1);
          return (
            <li key={i.key} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5">
              <span className="font-mono text-xs text-muted">#{n + 1}</span>
              <span className="truncate font-mono text-xs" title={label(i)}>
                {label(i)}
              </span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{i.rerankScore.toFixed(3)}</span>
              <span className={`flex w-14 items-center justify-end gap-0.5 text-xs ${move > 0 ? "text-success" : move < 0 ? "text-danger" : "text-muted"}`}>
                {move > 0 ? <ArrowUp className="size-3" /> : move < 0 ? <ArrowDown className="size-3" /> : <Equal className="size-3" />}
                {move === 0 ? "" : Math.abs(move)} (was #{i.fusedRank})
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type AnswerState = ReturnType<typeof useMutation<import("@/agent/explain-answer").ExplainAnswer, Error, string[]>>;

function AnswerPanel({ count, reranked, state, onGenerate }: { count: number; reranked: boolean; state: AnswerState; onGenerate: () => void }) {
  const a = state.data;
  return (
    <div className="mt-4 max-w-3xl">
      {!a && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={state.isPending || count === 0}
          className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {state.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Answer from the top {count}
          {reranked ? " reranked" : ""} chunks (one model call)
        </button>
      )}
      {state.error && <p className="mt-2 text-sm text-danger">{state.error.message}</p>}
      {a && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <Markdown>{a.answerMd}</Markdown>
            <p className="mt-2 text-xs text-muted">
              {a.tokens.toLocaleString("en-US")} tokens · ${a.costUsd.toFixed(4)}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-success/50 bg-surface p-3">
              <p className="text-sm font-medium text-success">Kept ({a.kept.length})</p>
              <p className="mb-1 text-xs text-muted">Each points inside a chunk the model was given.</p>
              <ul className="flex flex-col gap-0.5 font-mono text-xs break-all">
                {a.kept.map((c) => (
                  <li key={`${c.path}#${c.startLine}-${c.endLine}`}>
                    {c.repo}/{c.path}#L{c.startLine}-L{c.endLine}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`rounded-lg border bg-surface p-3 ${a.stripped.length ? "border-danger/50" : "border-line"}`}>
              <p className={`text-sm font-medium ${a.stripped.length ? "text-danger" : ""}`}>Stripped ({a.stripped.length})</p>
              <p className="mb-1 text-xs text-muted">
                {a.stripped.length ? "These pointed at lines the model was never given, so they became plain text." : "Every citation was grounded."}
              </p>
              <ul className="flex flex-col gap-0.5 font-mono text-xs break-all text-danger">
                {a.stripped.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ x, itemKey, pinned, onUnpin }: { x: SearchExplanation; itemKey: string; pinned: boolean; onUnpin: () => void }) {
  const i = [...x.fused, ...x.fts, ...x.vector, ...(x.reranked?.items ?? [])].find((n) => n.key === itemKey);
  if (!i) return null;
  const terms = [rrfTerm(x.rrfK, i.ftsRank), rrfTerm(x.rrfK, i.vecRank)].filter(Boolean).join(" + ");
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-mono text-sm break-all">{label(i)}</p>
        {pinned ? (
          <button type="button" onClick={onUnpin} className="flex shrink-0 items-center gap-1 rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-foreground">
            <PinOff className="size-3.5" /> Unpin
          </button>
        ) : (
          <span className="shrink-0 text-xs text-muted">Click a chunk to keep it here</span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{origin(i)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <Fact term="Full-text rank" value={i.ftsRank ? `#${i.ftsRank} · ${i.ftsScore?.toFixed(3)}` : "not found"} />
        <Fact term="Vector rank" value={i.vecRank ? `#${i.vecRank} · ${i.vecSimilarity?.toFixed(3)}` : "not in the nearest 50"} />
        <Fact term="Fused rank" value={`#${i.fusedRank}`} />
        <Fact term="RRF score" value={`${terms} = ${i.fusedScore.toFixed(4)}`} />
      </dl>
      <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-2 p-2 text-xs whitespace-pre-wrap">{i.hit.content}</pre>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{term}</dt>
      <dd className="font-mono break-words">{value}</dd>
    </div>
  );
}
