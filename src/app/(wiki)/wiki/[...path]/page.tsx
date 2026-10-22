import { notFound } from "next/navigation";
import { WikiMarkdown } from "@/components/markdown/WikiMarkdown";
import { CitationList } from "@/components/wiki/CitationList";
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
  return (
    <PageView
      key={page.id}
      page={page}
      wikiPaths={wikiPaths}
      staleFiles={staleFiles}
      hasProposal={revisions.some((r) => r.status === "proposed")}
      startEditing={sp.edit === "1"}
      citations={<CitationList citations={page.citations} />}
    >
      {page.revisionId ? (
        <WikiMarkdown wikiPaths={wikiPaths}>{page.bodyMd}</WikiMarkdown>
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
