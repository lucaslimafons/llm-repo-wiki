import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";
import { ProjectContextForm } from "@/components/project/ProjectContextForm";
import { DeleteWikiSection } from "@/components/wikis/DeleteWikiSection";
import { db } from "@/db/client";
import { getProjectContext } from "@/project/context";
import { requireWiki } from "@/wikis/server";

async function SettingsPageContent({ params }: Pick<PageProps<"/w/[wiki]/settings">, "params">) {
  await connection();
  const wiki = await requireWiki((await params).wiki);
  return (
    <>
      <ProjectContextForm initial={await getProjectContext(db(), wiki.id)} />
      <DeleteWikiSection />
    </>
  );
}

export default function SettingsPage({ params }: PageProps<"/w/[wiki]/settings">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <SettingsPageContent params={params} />
    </Suspense>
  );
}
