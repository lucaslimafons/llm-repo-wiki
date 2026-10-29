import { connection } from "next/server";
import { wikiStore } from "@/wiki/store";
import { routeWiki } from "@/wikis/route";

export async function GET(_req: Request, ctx: RouteContext<"/api/w/[wiki]/wiki/tree">) {
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  return Response.json(await wikiStore(wiki.id).listTree());
}
