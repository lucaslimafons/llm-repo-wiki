import { notFound } from "next/navigation";
import { WikiMarkdown } from "@/components/markdown/WikiMarkdown";
import { CitationList } from "@/components/wiki/CitationList";
import { PageProposalReview } from "@/components/wiki/PageProposalReview";
import { PageView } from "@/components/wiki/PageView";
import { wikiStore } from "@/wiki/store";
import { pathFromSegments } from "../../segments";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";
import { requireWiki } from "@/wikis/server";

async function WikiPageContent({ params, searchParams }: Pick<PageProps<"/w/[wiki]/wiki/[...path]">, "params" | "searchParams">) {
  const [{ wiki: slug, path }, sp] = await Promise.all([params, searchParams]);
  const wiki = await requireWiki(slug);
  const store = wikiStore(wiki.id);
  const page = await store.getPage({ path: pathFromSegments(path) });
  if (!page) notFound();
  const [wikiPaths, staleFiles, revisions] = await Promise.all([
    store.pagePaths(),
    page.stale ? store.staleFiles(page.id) : Promise.resolve([]),
    store.listRevisions(page.id),
  ]);
  const proposal = revisions.some((r) => r.status === "proposed")
    ? ((await store.listProposals({ pageId: page.id })).at(-1) ?? null)
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
        <WikiMarkdown wikiSlug={wiki.slug} wikiPaths={wikiPaths}>{shown.bodyMd}</WikiMarkdown>
      ) : (
        <p className="text-muted">No accepted content yet.</p>
      )}
    </PageView>
  );
}

export default function WikiPage({ params, searchParams }: PageProps<"/w/[wiki]/wiki/[...path]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <WikiPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
