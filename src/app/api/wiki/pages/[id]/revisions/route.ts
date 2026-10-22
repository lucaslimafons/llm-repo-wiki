import { z } from "zod";
import { WikiError } from "@/wiki/errors";
import { wikiStore } from "@/wiki/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/wiki/pages/[id]/revisions">) {
  const parsed = z.guid().safeParse((await ctx.params).id);
  if (!parsed.success) return Response.json({ error: "Invalid page id" }, { status: 400 });
  try {
    return Response.json(await wikiStore.listRevisionDetails(parsed.data));
  } catch (err) {
    if (err instanceof WikiError && err.code === "not_found") return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
