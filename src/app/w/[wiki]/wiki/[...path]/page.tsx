import { notFound } from "next/navigation";
import { WikiMarkdown } from "@/components/markdown/WikiMarkdown";
import { CitationList } from "@/components/wiki/CitationList";
import { PageProposalReview } from "@/components/wiki/PageProposalReview";
import { PageView } from "@/components/wiki/PageView";
import { wikiStore } from "@/wiki/store";
import { pathFromSegments } from "../../segments";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";

async function WikiPageContent({ params, searchParams }: Pick<PageProps<"/wiki/[...path]">, "params" | "searchParams">) {
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  const page = await wikiStore.getPage({ path: pathFromSegments(path) });
  if (!page) notFound();
  const [wikiPaths, staleFiles, revisions] = await Promise.all([
    wikiStore.pagePaths(),
    page.stale ? wikiStore.staleFiles(page.id) : Promise.resolve([]),
    wikiStore.listRevisions(page.id),
  ]);
  const proposal = revisions.some((r) => r.status === "proposed")
    ? ((await wikiStore.listProposals({ pageId: page.id })).at(-1) ?? null)
    : null;
  // A page that exists only as a proposal shows the proposed text, so it can be read before deciding.
  const shown = page.revisionId === null && proposal ? proposal : page;
  return (
    <PageView
      key={page.id}
      page={page}
      wikiPaths={wikiPaths}
      staleFiles={staleFiles}
      review={proposal ? <PageProposalReview proposal={proposal} /> : null}
      sourceCount={shown.citations.length}
      startEditing={sp.edit === "1"}
      citations={<CitationList citations={shown.citations} />}
    >
      {page.revisionId || proposal ? (
        <WikiMarkdown wikiPaths={wikiPaths}>{shown.bodyMd}</WikiMarkdown>
      ) : (
        <p className="text-muted">No accepted content yet.</p>
      )}
    </PageView>
  );
}

export default function WikiPage({ params, searchParams }: PageProps<"/wiki/[...path]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <WikiPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
