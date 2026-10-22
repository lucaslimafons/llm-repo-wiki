"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { revertRevisionAction } from "@/app/(wiki)/actions";
import type { RevisionDetail } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { fetchRevisions } from "./api";
import { Diff } from "./Diff";
import { RevisionMeta } from "./RevisionMeta";

/** Revisions newest first; the selected one is diffed against the revision it was written on. */
export function HistoryView({ pageId, pagePath, initialRevisions }: { pageId: string; pagePath: string; initialRevisions: RevisionDetail[] }) {
  const queryClient = useQueryClient();
  const { data: revisions } = useQuery({
    queryKey: queryKeys.wiki.revisions(pageId),
    queryFn: () => fetchRevisions(pageId),
    initialData: initialRevisions,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = revisions.find((r) => r.id === selectedId) ?? revisions[0];
  const base = selected?.parentRevisionId ? revisions.find((r) => r.id === selected.parentRevisionId) : undefined;

  const revert = useMutation({
    mutationFn: async (revisionId: string) => {
      const res = await revertRevisionAction({ revisionId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (data) => {
      setSelectedId(data.revisionId);
      return queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <p className="text-xs text-muted">History</p>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        <Link href={wikiRoute(pagePath)} className="hover:text-accent">
          {pagePath}
        </Link>
      </h1>
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <ol className="flex flex-col gap-1">
          {revisions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-md border px-3 py-2 text-left ${r.id === selected?.id ? "border-accent bg-surface" : "border-transparent hover:bg-surface-2"}`}
              >
                <span className="block truncate text-sm">
                  {r.reason ?? "No reason given"}
                  {r.isCurrent && <span className="ml-1 text-xs text-accent">(current)</span>}
                </span>
                <RevisionMeta rev={r} />
              </button>
            </li>
          ))}
        </ol>
        {selected && (
          <section className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{selected.reason ?? "No reason given"}</p>
                <RevisionMeta rev={selected} />
              </div>
              {selected.status === "accepted" && !selected.isCurrent && (
                <button
                  type="button"
                  disabled={revert.isPending}
                  onClick={() => revert.mutate(selected.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
                >
                  <RotateCcw className="size-4" /> Restore this version
                </button>
              )}
              {selected.status === "proposed" && (
                <Link href="/proposals" className="shrink-0 text-sm text-accent hover:underline">
                  Review proposal
                </Link>
              )}
            </div>
            {revert.error && <p role="alert" className="text-sm text-danger">{revert.error.message}</p>}
            {base && base.title !== selected.title && (
              <p className="text-sm text-muted">
                Title: <span className="line-through">{base.title}</span> → {selected.title}
              </p>
            )}
            <Diff
              oldValue={base?.bodyMd ?? ""}
              newValue={selected.bodyMd}
              oldTitle={base ? `Before (${base.id.slice(0, 8)})` : "Empty"}
              newTitle={`This revision (${selected.id.slice(0, 8)})`}
            />
          </section>
        )}
      </div>
    </div>
  );
}
