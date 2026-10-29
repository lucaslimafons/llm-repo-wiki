import { connection } from "next/server";
import { wikiPathSchema } from "@/agent/wiki-path";
import { wikiStore } from "@/wiki/store";
import { routeWiki } from "@/wikis/route";

/** Current body of a page, for the approval card's diff of an updatePage call. */
export async function GET(req: Request, ctx: RouteContext<"/api/w/[wiki]/chat/page">) {
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const path = wikiPathSchema.safeParse(new URL(req.url).searchParams.get("path"));
  if (!path.success) return Response.json({ error: "invalid path" }, { status: 400 });
  const page = await wikiStore(wiki.id).getPage({ path: path.data });
  if (!page) return Response.json({ error: "page not found" }, { status: 404 });
  return Response.json({ path: page.path, bodyMd: page.bodyMd, revisionId: page.revisionId });
}
