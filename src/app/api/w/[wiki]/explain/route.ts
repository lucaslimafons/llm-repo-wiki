import { describeIssues } from "@/lib/zod-issues";
import { explainInputSchema, explainSearch } from "@/search/explain";
import { routeWiki } from "@/wikis/route";

/** Hybrid search with its working shown (both lists, ranks, fusion, optional rerank). */
export async function POST(req: Request, ctx: RouteContext<"/api/w/[wiki]/explain">): Promise<Response> {
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const parsed = explainInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: describeIssues(parsed.error) }, { status: 400 });
  try {
    return Response.json(await explainSearch(wiki.id, parsed.data));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "search failed" }, { status: 500 });
  }
}
