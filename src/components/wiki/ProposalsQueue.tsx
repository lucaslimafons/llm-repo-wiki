"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, FilePlus2, FileDiff, Search, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { decideRevisionsAction } from "@/app/(wiki)/actions";
import type { BulkDecision } from "@/wiki/review";
import { Disclosure } from "@/components/ui/Disclosure";
import { queryKeys } from "@/lib/query-keys";
import type { ProposalSummary } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { fetchProposal, fetchProposals } from "./api";
import { CitationList } from "./CitationList";
import { Diff } from "./Diff";
import { ProposalDecision, readableReason } from "./ProposalDecision";

const TOP_LEVEL = "(top level)";
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : TOP_LEVEL);

/** The review queue: titles only, grouped by folder; a diff loads when a row is opened. */
export function ProposalsQueue({ initialProposals }: { initialProposals: ProposalSummary[] }) {
  const queryClient = useQueryClient();
  const { data: proposals } = useQuery({
    queryKey: queryKeys.wiki.proposals(),
    queryFn: fetchProposals,
    initialData: initialProposals,
  });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulk = useMutation({
    mutationFn: async (accept: boolean): Promise<BulkDecision> => {
      const res = await decideRevisionsAction({ revisionIds: [...selected], accept });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      setSelected(new Set());
      return queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
    },
  });

  const needle = filter.trim().toLowerCase();
  const visible = proposals.filter((p) => !needle || p.pagePath.toLowerCase().includes(needle) || readableReason(p.reason)?.toLowerCase().includes(needle));
  const groups = Map.groupBy(visible, (p) => folderOf(p.pagePath));
  const live = proposals.filter((p) => selected.has(p.id)).map((p) => p.id);
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
      <p className="mt-1 mb-4 text-sm text-muted">
        Pages the background agent wrote or changed, waiting for you. Open a row to see the change, or review a page where it lives.
      </p>

      {proposals.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">Nothing to review.</p>
      ) : (
        <>
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 border-b border-line bg-background py-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-sm focus-within:border-accent">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${proposals.length} proposals by path or reason`}
                aria-label="Filter proposals"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <button type="button" onClick={() => toggle(visible.map((p) => p.id), true)} className="rounded border border-line px-2 py-1 text-sm hover:bg-surface-2">
              Select {needle ? "shown" : "all"} ({visible.length})
            </button>
            {live.length > 0 && (
              <>
                <span className="text-sm text-muted">{live.length} selected</span>
                <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-muted hover:text-foreground">
                  Clear
                </button>
                <button
                  type="button"
                  disabled={bulk.isPending}
                  onClick={() => bulk.mutate(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
                >
                  <X className="size-4" /> Reject selected
                </button>
                <button
                  type="button"
                  disabled={bulk.isPending}
                  onClick={() => bulk.mutate(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50"
                >
                  <Check className="size-4" /> Accept selected
                </button>
              </>
            )}
          </div>

          {bulk.error && <p role="alert" className="mb-3 text-sm text-danger">{bulk.error.message}</p>}
          {bulk.data && (
            <div role="status" className="mb-3 text-sm">
              <p>{bulk.data.done} done.</p>
              {bulk.data.failed.map((f) => (
                <p key={f.revisionId} className="text-danger">
                  {f.path}: {f.error}
                </p>
              ))}
            </div>
          )}

          {visible.length === 0 && <p className="text-sm text-muted">No proposal matches “{filter}”.</p>}
          <div className="flex flex-col gap-4">
            {[...groups].map(([folder, items]) => {
              const ids = items.map((p) => p.id);
              const all = ids.every((id) => selected.has(id));
              return (
                <section key={folder}>
                  <label className="mb-1 flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} aria-label={`Select all in ${folder}`} />
                    <span className="break-all">{folder}</span>
                    <span className="text-muted">({items.length})</span>
                  </label>
                  <ul className="divide-y divide-line rounded-md border border-line bg-surface">
                    {items.map((p) => (
                      <ProposalRow key={p.id} proposal={p} checked={selected.has(p.id)} onCheck={(on) => toggle([p.id], on)} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ProposalRow({ proposal: p, checked, onCheck }: { proposal: ProposalSummary; checked: boolean; onCheck: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const reason = readableReason(p.reason);
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${p.pagePath}`} />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Hide the change" : "Show the change"} className="text-muted hover:text-foreground">
          <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {p.isNewPage ? <FilePlus2 className="size-4 shrink-0 text-accent" aria-label="New page" /> : <FileDiff className="size-4 shrink-0 text-muted" aria-label="Change" />}
        <Link href={wikiRoute(p.pagePath)} className="min-w-0 font-medium break-all hover:text-accent">
          {p.pagePath.split("/").at(-1)}
        </Link>
        <span className="text-xs text-muted">{p.citationCount} citations</span>
        {p.outdated && (
          <span className="inline-flex items-center gap-1 text-xs text-warning" title="The page changed after this was proposed">
            <TriangleAlert className="size-3.5" /> Outdated
          </span>
        )}
        <span className="ml-auto">
          <ProposalDecision revisionId={p.id} outdated={p.outdated} />
        </span>
      </div>
      {reason && <p className="mt-1 ml-12 text-xs break-words text-muted">{reason}</p>}
      {open && <ProposalDetail revisionId={p.id} />}
    </li>
  );
}

function ProposalDetail({ revisionId }: { revisionId: string }) {
  const detail = useQuery({ queryKey: queryKeys.wiki.proposal(revisionId), queryFn: () => fetchProposal(revisionId) });
  if (detail.isPending) return <p className="mt-2 text-xs text-muted">Loading the change…</p>;
  if (detail.error) return <p className="mt-2 text-xs text-danger">{detail.error.message}</p>;
  const p = detail.data;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <Diff oldValue={p.currentBodyMd} newValue={p.bodyMd} oldTitle={p.isNewPage ? "New page" : "Current"} newTitle="Proposed" />
      <Disclosure summary={`Citations (${p.citations.length})`}>
        <CitationList citations={p.citations} />
      </Disclosure>
    </div>
  );
}
