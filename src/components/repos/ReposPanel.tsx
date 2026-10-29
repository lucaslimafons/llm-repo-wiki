import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { listRepos } from "@/ingest/repos";
import type { WikiRef } from "@/wikis/schema";
import { ReposPanelClient } from "./ReposPanelClient";

/** Server half: the first list comes from the DB, so the panel never renders empty-then-filled. */
export function ReposPanel({ wiki }: { wiki: WikiRef }) {
  return (
    <Suspense fallback={<ReposPanelClient initialRepos={null} />}>
      <ReposPanelLoader wiki={wiki} />
    </Suspense>
  );
}

async function ReposPanelLoader({ wiki }: { wiki: WikiRef }) {
  await connection();
  return <ReposPanelClient initialRepos={await listRepos(db(), wiki.id)} />;
}
