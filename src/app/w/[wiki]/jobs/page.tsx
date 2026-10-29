import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";
import { JobsView } from "@/components/jobs/JobsView";
import { db } from "@/db/client";
import { getJobsOverview } from "@/jobs/overview";
import { requireWiki } from "@/wikis/server";

async function JobsPageContent({ params }: Pick<PageProps<"/w/[wiki]/jobs">, "params">) {
  await connection();
  const wiki = await requireWiki((await params).wiki);
  return <JobsView initial={await getJobsOverview(db(), wiki.id)} />;
}

export default function JobsPage({ params }: PageProps<"/w/[wiki]/jobs">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <JobsPageContent params={params} />
    </Suspense>
  );
}
