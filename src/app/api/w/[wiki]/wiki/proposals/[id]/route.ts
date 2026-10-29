import { connection } from "next/server";
import { z } from "zod";
import { wikiStore } from "@/wiki/store";
import { routeWiki } from "@/wikis/route";

/** One proposal with its body and the page's current body, loaded when a queue row is expanded. */
export async function GET(_req: Request, ctx: RouteContext<"/api/w/[wiki]/wiki/proposals/[id]">) {
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const id = z.guid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid id" }, { status: 400 });
  const [proposal] = await wikiStore(wiki.id).listProposals({ revisionId: id.data });
  return proposal ? Response.json(proposal) : Response.json({ error: "not found" }, { status: 404 });
}
