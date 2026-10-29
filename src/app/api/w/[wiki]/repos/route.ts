import { connection } from "next/server";
import { db } from "@/db/client";
import { listRepos } from "@/ingest/repos";
import { routeWiki } from "@/wikis/route";

/** The repo list ReposPanel polls while a sync runs. */
export async function GET(_req: Request, ctx: RouteContext<"/api/w/[wiki]/repos">): Promise<Response> {
  // Under cacheComponents a GET handler can be prerendered; this one must read live status.
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  return Response.json(await listRepos(db(), wiki.id));
}
