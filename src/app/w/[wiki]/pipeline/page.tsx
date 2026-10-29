import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";
import { PipelineView } from "@/components/viz/PipelineView";
import { db } from "@/db/client";
import { getRepoTimeline } from "@/jobs/timeline";
import { requireWiki } from "@/wikis/server";

async function PipelinePageContent({ params, searchParams }: Pick<PageProps<"/w/[wiki]/pipeline">, "params" | "searchParams">) {
  await connection();
  const [{ wiki: slug }, { repo }] = await Promise.all([params, searchParams]);
  const wiki = await requireWiki(slug);
  const initial = await getRepoTimeline(db(), wiki.id, { repoId: typeof repo === "string" ? repo : undefined });
  return <PipelineView key={initial.repo?.id ?? "none"} initial={initial} />;
}

export default function PipelinePage({ params, searchParams }: PageProps<"/w/[wiki]/pipeline">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PipelinePageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
