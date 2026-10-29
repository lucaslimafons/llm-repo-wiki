import { z } from "zod";
import { db } from "@/db/client";
import { wikiStore } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { getWikiBySlug } from "@/wikis/wikis";

/** `wiki:<id>` links rendered without a path map (chat) land here and redirect to the page. */
export async function GET(request: Request, ctx: RouteContext<"/w/[wiki]/page/[id]">) {
  const params = await ctx.params;
  const wiki = await getWikiBySlug(db(), params.wiki);
  const id = z.guid().safeParse(params.id);
  // The bound store only finds pages of this wiki, so an id from another wiki is a 404.
  const page = wiki && id.success ? await wikiStore(wiki.id).getPage({ id: id.data }) : null;
  if (!wiki || !page) return new Response("Page not found", { status: 404 });
  return Response.redirect(new URL(wikiRoute(wiki.slug, page.path), request.url), 307);
}
