import { z } from "zod";
import { WikiError } from "@/wiki/errors";
import { wikiStore } from "@/wiki/store";
import { routeWiki } from "@/wikis/route";

export async function GET(_req: Request, ctx: RouteContext<"/api/w/[wiki]/wiki/pages/[id]/revisions">) {
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const parsed = z.guid().safeParse((await ctx.params).id);
  if (!parsed.success) return Response.json({ error: "Invalid page id" }, { status: 400 });
  try {
    return Response.json(await wikiStore(wiki.id).listRevisionDetails(parsed.data));
  } catch (err) {
    if (err instanceof WikiError && err.code === "not_found") return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
