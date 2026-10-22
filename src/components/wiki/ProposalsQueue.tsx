"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FilePlus2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { queryKeys } from "@/lib/query-keys";
import { acceptRevisionAction, rejectRevisionAction } from "@/app/(wiki)/actions";
import type { ProposalView } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { fetchProposals } from "./api";
import { CitationList } from "./CitationList";
import { Diff } from "./Diff";
import { RevisionMeta } from "./RevisionMeta";

export function ProposalsQueue({ initialProposals }: { initialProposals: ProposalView[] }) {
  const { data: proposals } = useQuery({
    queryKey: queryKeys.wiki.proposals(),
    queryFn: fetchProposals,
    initialData: initialProposals,
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Changes the background agent wrote for review. Accepting one makes it the page&apos;s current revision.
      </p>
      {proposals.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({ proposal: p }: { proposal: ProposalView }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: async (accept: boolean) => {
      const res = accept ? await acceptRevisionAction({ revisionId: p.id }) : await rejectRevisionAction({ revisionId: p.id });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all }),
  });

  return (
    <li className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {p.isNewPage && <FilePlus2 className="size-4 shrink-0 text-accent" aria-label="New page" />}
            <Link href={wikiRoute(p.pagePath)} className="truncate font-medium hover:text-accent">
              {p.pagePath}
            </Link>
            {p.title !== p.currentTitle && !p.isNewPage && (
              <span className="text-xs text-muted">→ renamed to “{p.title}”</span>
            )}
          </div>
          <RevisionMeta rev={p} />
        </div>
        {p.outdated && (
          <span className="inline-flex items-center gap-1 text-xs text-warning" title="The page changed after this was proposed">
            <TriangleAlert className="size-3.5" /> Outdated
          </span>
        )}
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          <X className="size-4" /> Reject
        </button>
        <button
          type="button"
          disabled={decide.isPending || p.outdated}
          onClick={() => decide.mutate(true)}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          <Check className="size-4" /> Accept
        </button>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {p.reason && <p className="text-sm">{p.reason}</p>}
        {decide.error && <p role="alert" className="text-sm text-danger">{decide.error.message}</p>}
        <Diff
          oldValue={p.currentBodyMd}
          newValue={p.bodyMd}
          oldTitle={p.isNewPage ? "New page" : "Current"}
          newTitle="Proposed"
        />
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted">Citations</h3>
          <CitationList citations={p.citations} />
        </div>
      </div>
    </li>
  );
}
