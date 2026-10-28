"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { acceptRevisionAction, rejectRevisionAction } from "@/app/(wiki)/actions";
import { queryKeys } from "@/lib/query-keys";

/** Accept / Reject for one proposal. The action refreshes server-rendered parts; the queries refetch. */
export function ProposalDecision({ revisionId, outdated }: { revisionId: string; outdated: boolean }) {
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: async (accept: boolean) => {
      const res = accept ? await acceptRevisionAction({ revisionId }) : await rejectRevisionAction({ revisionId });
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all }),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {decide.error && <p role="alert" className="text-sm text-danger">{decide.error.message}</p>}
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
        disabled={decide.isPending || outdated}
        title={outdated ? "The page changed after this was proposed: reject it and re-propose" : undefined}
        onClick={() => decide.mutate(true)}
        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        <Check className="size-4" /> Accept
      </button>
    </div>
  );
}

/** "author-wiki <sha>: why" → "why": the sha is noise when reading the queue. */
export function readableReason(reason: string | null): string | null {
  return reason?.replace(/^author-wiki [0-9a-f]{7,40}: /, "") ?? null;
}
