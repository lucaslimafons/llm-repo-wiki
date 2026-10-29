import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";
import { ProjectContextForm } from "@/components/project/ProjectContextForm";
import { db } from "@/db/client";
import { getProjectContext } from "@/project/context";

async function ProjectPageContent() {
  await connection();
  return <ProjectContextForm initial={await getProjectContext(db())} />;
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ProjectPageContent />
    </Suspense>
  );
}
