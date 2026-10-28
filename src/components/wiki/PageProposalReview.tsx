"use client";

import { GitPullRequestArrow, TriangleAlert } from "lucide-react";
import type { ProposalView } from "@/wiki/store";
import { Disclosure } from "@/components/ui/Disclosure";
import { Diff } from "./Diff";
import { ProposalDecision, readableReason } from "./ProposalDecision";
import { RevisionMeta } from "./RevisionMeta";

/** The review, where the page is: no hunting through the queue for the one you are reading. */
export function PageProposalReview({ proposal: p }: { proposal: ProposalView }) {
  const reason = readableReason(p.reason);
  return (
    <section aria-label="Pending proposal" className="mb-4 rounded-md border border-accent/60 bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <GitPullRequestArrow className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {p.isNewPage ? "Proposed new page: you are reading the proposal." : "A change to this page is waiting for review."}
            </p>
            {reason && <p className="text-xs break-words text-muted">{reason}</p>}
            <RevisionMeta rev={p} />
          </div>
        </div>
        <ProposalDecision revisionId={p.id} outdated={p.outdated} />
      </div>
      {p.outdated && (
        <p className="mt-2 flex items-center gap-1 text-xs text-warning">
          <TriangleAlert className="size-3.5" /> The page changed after this was proposed. Reject it and re-propose.
        </p>
      )}
      {!p.isNewPage && (
        <div className="mt-2">
          <Disclosure summary={<span className="text-sm">Show the change</span>}>
            <Diff oldValue={p.currentBodyMd} newValue={p.bodyMd} oldTitle="Current" newTitle="Proposed" />
          </Disclosure>
        </div>
      )}
    </section>
  );
}
