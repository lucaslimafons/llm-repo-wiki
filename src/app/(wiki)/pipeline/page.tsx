import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";
import { PipelineView } from "@/components/viz/PipelineView";
import { db } from "@/db/client";
import { getRepoTimeline } from "@/jobs/timeline";

async function PipelinePageContent({ searchParams }: Pick<PageProps<"/pipeline">, "searchParams">) {
  await connection();
  const { repo } = await searchParams;
  const initial = await getRepoTimeline(db(), { repoId: typeof repo === "string" ? repo : undefined });
  return <PipelineView key={initial.repo?.id ?? "none"} initial={initial} />;
}

export default function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PipelinePageContent searchParams={searchParams} />
    </Suspense>
  );
}
