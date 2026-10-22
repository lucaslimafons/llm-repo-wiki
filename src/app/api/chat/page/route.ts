import { connection } from "next/server";
import { wikiPathSchema } from "@/agent/wiki-path";
import { wikiStore } from "@/wiki/store";

/** Current body of a page, for the approval card's diff of an updatePage call. */
export async function GET(req: Request) {
  await connection();
  const path = wikiPathSchema.safeParse(new URL(req.url).searchParams.get("path"));
  if (!path.success) return Response.json({ error: "invalid path" }, { status: 400 });
  const page = await wikiStore.getPage({ path: path.data });
  if (!page) return Response.json({ error: "page not found" }, { status: 404 });
  return Response.json({ path: page.path, bodyMd: page.bodyMd });
}
