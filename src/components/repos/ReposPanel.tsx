import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { listRepos } from "@/ingest/repos";
import { ReposPanelClient } from "./ReposPanelClient";

/** Server half: the first list comes from the DB, so the panel never renders empty-then-filled. */
export function ReposPanel() {
  return (
    <Suspense fallback={<ReposPanelClient initialRepos={null} />}>
      <ReposPanelLoader />
    </Suspense>
  );
}

async function ReposPanelLoader() {
  await connection();
  return <ReposPanelClient initialRepos={await listRepos(db())} />;
}
