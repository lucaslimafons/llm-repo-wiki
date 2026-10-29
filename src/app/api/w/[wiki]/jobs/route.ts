import { connection } from "next/server";
import { db } from "@/db/client";
import { getJobsOverview } from "@/jobs/overview";
import { routeWiki } from "@/wikis/route";

/** The overview /jobs polls. Read live: nothing here may be prerendered. */
export async function GET(_req: Request, ctx: RouteContext<"/api/w/[wiki]/jobs">): Promise<Response> {
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  return Response.json(await getJobsOverview(db(), wiki.id));
}
