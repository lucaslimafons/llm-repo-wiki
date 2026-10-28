import { connection } from "next/server";
import { Suspense } from "react";
import { ReposPanel } from "@/components/repos/ReposPanel";
import { wikiStore } from "@/wiki/store";
import { PageTree } from "./PageTree";

async function TreeLoader() {
  await connection();
  const [tree, proposalCount] = await Promise.all([wikiStore.listTree(), wikiStore.countProposals()]);
  return <PageTree initialTree={tree} proposalCount={proposalCount} />;
}

/** Page tree (wiki track) above the repos panel (ingest track). */
export function WikiSidebar() {
  return (
    <div className="flex flex-col">
      <Suspense fallback={<p className="p-4 text-sm text-muted">Loading pages…</p>}>
        <TreeLoader />
      </Suspense>
      <ReposPanel />
    </div>
  );
}
