import { notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import type { ActionResult } from "@/ingest/repos";
import type { WikiRef } from "./schema";
import { getWikiBySlug } from "./wikis";

/** The wiki a /w/<slug>/… page or route is in; an unknown slug is a 404. Cached per request. */
export const requireWiki = cache(async (slug: string): Promise<WikiRef> => {
  const wiki = await getWikiBySlug(db(), slug);
  if (!wiki) notFound();
  return wiki;
});

/** Server Actions get the slug from the client: resolve it, and refuse an unknown one. */
export async function withWiki<T>(slug: unknown, fn: (wiki: WikiRef) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const wiki = typeof slug === "string" ? await getWikiBySlug(db(), slug) : null;
  if (!wiki) return { ok: false, error: "Wiki not found." };
  return fn(wiki);
}
