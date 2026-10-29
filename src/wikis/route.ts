import { db } from "@/db/client";
import type { WikiRef } from "./schema";
import { getWikiBySlug } from "./wikis";

/** For /api/w/<slug>/… handlers: the wiki, or a 404 JSON response to return as is. */
export async function routeWiki(params: Promise<{ wiki: string }>): Promise<WikiRef | Response> {
  const wiki = await getWikiBySlug(db(), (await params).wiki);
  return wiki ?? Response.json({ error: "wiki not found" }, { status: 404 });
}
