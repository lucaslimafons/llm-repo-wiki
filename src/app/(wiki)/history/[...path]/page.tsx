import { notFound } from "next/navigation";
import { HistoryView } from "@/components/wiki/HistoryView";
import { wikiStore } from "@/wiki/store";
import { pathFromSegments } from "../../segments";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";

async function HistoryPageContent({ params }: Pick<PageProps<"/history/[...path]">, "params">) {
  const page = await wikiStore.getPage({ path: pathFromSegments((await params).path) });
  if (!page) notFound();
  const revisions = await wikiStore.listRevisionDetails(page.id);
  return <HistoryView key={page.id} pageId={page.id} pagePath={page.path} initialRevisions={revisions} />;
}

export default function HistoryPage({ params }: PageProps<"/history/[...path]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <HistoryPageContent params={params} />
    </Suspense>
  );
}
