import { connection } from "next/server";
import { ProposalsQueue } from "@/components/wiki/ProposalsQueue";
import { wikiStore } from "@/wiki/store";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";

async function ProposalsPageContent() {
  await connection();
  return <ProposalsQueue initialProposals={await wikiStore.listProposals()} />;
}

export default function ProposalsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ProposalsPageContent />
    </Suspense>
  );
}
