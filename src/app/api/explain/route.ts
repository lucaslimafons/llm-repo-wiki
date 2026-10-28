import { explainInputSchema, explainSearch } from "@/search/explain";

/** Hybrid search with its working shown (both lists, ranks, fusion, optional rerank). */
export async function POST(req: Request): Promise<Response> {
  const parsed = explainInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type a question of up to 500 characters." }, { status: 400 });
  try {
    return Response.json(await explainSearch(parsed.data));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "search failed" }, { status: 500 });
  }
}
