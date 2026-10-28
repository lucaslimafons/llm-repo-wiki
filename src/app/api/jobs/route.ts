import { connection } from "next/server";
import { db } from "@/db/client";
import { getJobsOverview } from "@/jobs/overview";

/** The overview /jobs polls. Read live: nothing here may be prerendered. */
export async function GET(): Promise<Response> {
  await connection();
  return Response.json(await getJobsOverview(db()));
}
