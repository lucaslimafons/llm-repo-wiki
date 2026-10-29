import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";
import { JobsView } from "@/components/jobs/JobsView";
import { db } from "@/db/client";
import { getJobsOverview } from "@/jobs/overview";

async function JobsPageContent() {
  await connection();
  return <JobsView initial={await getJobsOverview(db())} />;
}

export default function JobsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <JobsPageContent />
    </Suspense>
  );
}
