import { connection } from "next/server";
import { db } from "@/db/client";
import { listRepos } from "@/ingest/repos";

/** The repo list ReposPanel polls while a sync runs. */
export async function GET(): Promise<Response> {
  // Under cacheComponents a GET handler can be prerendered; this one must read live status.
  await connection();
  return Response.json(await listRepos(db()));
}
