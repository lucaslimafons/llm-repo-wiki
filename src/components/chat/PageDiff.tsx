"use client";

import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { queryKeys } from "@/lib/query-keys";
import { useWiki } from "@/components/wikis/WikiContext";
import { chatApi } from "./api";

// The diff viewer touches the DOM and is heavy: client-only and loaded on first approval card.
const DiffViewer = dynamic(() => import("react-diff-viewer-continued"), {
  ssr: false,
  loading: () => <p className="p-2 text-xs text-muted">Loading diff…</p>,
});

/** Current page body (fetched) against the body the agent wants to write. */
export function PageDiff({ path, newBody, baseRevision }: { path: string; newBody: string; baseRevision: string }) {
  const { slug } = useWiki();
  const current = useQuery({
    queryKey: queryKeys.chat.pageBody(slug, path),
    queryFn: () => chatApi.pageBody(slug, path),
    staleTime: 0,
  });
  if (current.isPending) return <p className="p-2 text-xs text-muted">Loading current page…</p>;
  if (current.isError) return <p className="p-2 text-xs text-danger">Couldn&apos;t load the current page: {current.error.message}</p>;
  return (
    <>
      {current.data.revisionId !== baseRevision && (
        <p className="mb-1 text-xs text-warning">This page changed after the agent read it. Approving will fail; ask it to re-read.</p>
      )}
      <div className="max-h-72 overflow-auto rounded border border-line text-xs">
        <DiffViewer oldValue={current.data.bodyMd} newValue={newBody} splitView={false} hideLineNumbers showDiffOnly />
      </div>
    </>
  );
}
