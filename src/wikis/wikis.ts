import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pages, wikis } from "@/db/schema";
import { isUniqueViolation } from "@/wiki/errors";
import type { ActionResult } from "@/ingest/repos";
import { describeIssues } from "@/lib/zod-issues";
import { createWikiInputSchema, slugify, wikiSlugSchema, type WikiListItem, type WikiRef } from "./schema";

const ref = { id: wikis.id, slug: wikis.slug, name: wikis.name };

export async function listWikis(db: Db): Promise<WikiListItem[]> {
  return db
    .select({
      ...ref,
      // Raw qualified names: drizzle renders ${wikis.id} unqualified, which binds to the subquery's own id.
      repoCount: sql<number>`(select count(*)::int from repos r where r.wiki_id = "wikis"."id")`,
      pageCount: sql<number>`(select count(*)::int from pages p where p.wiki_id = "wikis"."id")`,
    })
    .from(wikis)
    .orderBy(asc(wikis.name), asc(wikis.slug));
}

export async function getWikiBySlug(db: Db, slug: string): Promise<WikiRef | null> {
  if (!wikiSlugSchema.safeParse(slug).success) return null;
  const [row] = await db.select(ref).from(wikis).where(eq(wikis.slug, slug));
  return row ?? null;
}

/** The slug comes from the name; a taken one gets -2, -3, … */
export async function createWiki(db: Db, input: unknown): Promise<ActionResult<WikiRef>> {
  const parsed = createWikiInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: describeIssues(parsed.error) };
  const { name, context, layout } = parsed.data;
  const base = slugify(name) || "wiki";
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    try {
      const [row] = await db.insert(wikis).values({ slug, name, context, layout }).returning(ref);
      return { ok: true, data: row };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return { ok: false, error: "Could not find a free URL for this name; try another name." };
}

/** Deletes the wiki with its repos' index, pages, chats and history. Queued jobs for its repos find no repo and stop. */
export async function deleteWiki(db: Db, wikiId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // pages.parent_id is ON DELETE RESTRICT: detach the tree so the cascade can remove every page.
    await tx.update(pages).set({ parentId: null }).where(eq(pages.wikiId, wikiId));
    const gone = await tx.delete(wikis).where(eq(wikis.id, wikiId)).returning({ id: wikis.id });
    return gone.length > 0;
  });
}

/** For the CLI and MCP: the named wiki, or the only one. Several wikis and no name is an error that lists them. */
export async function resolveWiki(db: Db, slug: string | undefined): Promise<WikiRef> {
  if (slug) {
    const wiki = await getWikiBySlug(db, slug);
    if (wiki) return wiki;
  }
  const all = await db.select(ref).from(wikis).orderBy(asc(wikis.slug));
  if (!slug && all.length === 1) return all[0];
  const names = all.map((w) => w.slug).join(", ") || "none yet";
  throw new Error(
    slug ? `No wiki "${slug}". Wikis: ${names}.` : all.length === 0 ? "No wiki exists yet: create one in the app first." : `Several wikis exist; pass --wiki <slug>. Wikis: ${names}.`,
  );
}
