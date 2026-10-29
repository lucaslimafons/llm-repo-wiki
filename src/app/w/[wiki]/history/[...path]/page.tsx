import { notFound } from "next/navigation";
import { HistoryView } from "@/components/wiki/HistoryView";
import { wikiStore } from "@/wiki/store";
import { requireWiki } from "@/wikis/server";
import { pathFromSegments } from "../../segments";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";

async function HistoryPageContent({ params }: Pick<PageProps<"/w/[wiki]/history/[...path]">, "params">) {
  const { wiki: slug, path } = await params;
  const store = wikiStore((await requireWiki(slug)).id);
  const page = await store.getPage({ path: pathFromSegments(path) });
  if (!page) notFound();
  const revisions = await store.listRevisionDetails(page.id);
  return <HistoryView key={page.id} pageId={page.id} pagePath={page.path} initialRevisions={revisions} />;
}

export default function HistoryPage({ params }: PageProps<"/w/[wiki]/history/[...path]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <HistoryPageContent params={params} />
    </Suspense>
  );
}
