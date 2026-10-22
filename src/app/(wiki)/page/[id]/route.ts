import { z } from "zod";
import { wikiStore } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";

/** `wiki:<id>` links rendered without a path map (chat) land here and redirect to the page. */
export async function GET(request: Request, ctx: RouteContext<"/page/[id]">) {
  const id = z.guid().safeParse((await ctx.params).id);
  const page = id.success ? await wikiStore.getPage({ id: id.data }) : null;
  if (!page) return new Response("Page not found", { status: 404 });
  return Response.redirect(new URL(wikiRoute(page.path), request.url), 307);
}
