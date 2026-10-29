import { connection } from "next/server";
import { ProposalsQueue } from "@/components/wiki/ProposalsQueue";
import { wikiStore } from "@/wiki/store";
import { requireWiki } from "@/wikis/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";

async function ProposalsPageContent({ params }: Pick<PageProps<"/w/[wiki]/proposals">, "params">) {
  await connection();
  const wiki = await requireWiki((await params).wiki);
  return <ProposalsQueue initialProposals={await wikiStore(wiki.id).listProposalSummaries()} />;
}

export default function ProposalsPage({ params }: PageProps<"/w/[wiki]/proposals">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ProposalsPageContent params={params} />
    </Suspense>
  );
}
