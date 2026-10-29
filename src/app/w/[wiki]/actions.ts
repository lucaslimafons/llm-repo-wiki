"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Author } from "@/core/contracts";
import { db } from "@/db/client";
import { extractCitations } from "@/wiki/citations";
import { WikiError } from "@/wiki/errors";
import { decideProposals } from "@/wiki/review";
import { wikiStore, type WikiStoreExt } from "@/wiki/store";
import { pageTitleSchema } from "@/wiki/title";
import { getWikiBySlug } from "@/wikis/wikis";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const human: Author = { kind: "human" };
const id = z.guid();

type InWiki = { wiki: string };

/**
 * Resolves the wiki from its slug, validates, runs against that wiki's store, refreshes
 * server-rendered parts, and returns expected failures as data. An id from another wiki is not found.
 */
async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (v: z.infer<S>, store: WikiStoreExt) => Promise<T>,
): Promise<ActionResult<T>> {
  const slug = (input as Partial<InWiki> | null)?.wiki;
  const wiki = typeof slug === "string" ? await getWikiBySlug(db(), slug) : null;
  if (!wiki) return { ok: false, error: "Wiki not found." };
  const store = wikiStore(wiki.id);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  let data: T;
  try {
    data = await fn(parsed.data, store);
  } catch (err) {
    if (err instanceof WikiError) return { ok: false, error: err.message };
    console.error("[wiki action]", err);
    return { ok: false, error: "Something went wrong. Check the server log." };
  }
  refresh();
  return { ok: true, data };
}

export async function createPageAction(input: { wiki: string; parentId: string | null; title: string }) {
  return run(z.object({ parentId: id.nullable(), title: pageTitleSchema }), input, async (v, store) => {
    const { pageId } = await store.createPage({
      parentId: v.parentId,
      title: v.title,
      bodyMd: `# ${v.title}\n`,
      reason: "Created in the editor",
      citations: [],
      author: human,
      mode: "apply",
    });
    const page = await store.getPage({ id: pageId });
    return { pageId, path: page!.path };
  });
}

export async function savePageAction(input: { wiki: string; pageId: string; bodyMd: string; title?: string; baseRevisionId: string | null }) {
  const schema = z.object({
    pageId: id,
    bodyMd: z.string().max(200_000),
    title: pageTitleSchema.optional(),
    baseRevisionId: id.nullable(),
  });
  return run(schema, input, async (v, store) => {
    await store.updatePage({
      pageId: v.pageId,
      bodyMd: v.bodyMd,
      title: v.title,
      reason: "Edited in the editor",
      citations: extractCitations(v.bodyMd),
      author: human,
      mode: "apply",
      baseRevisionId: v.baseRevisionId,
    });
    return (await store.getPage({ id: v.pageId }))!;
  });
}

export async function renamePageAction(input: { wiki: string; pageId: string; title: string }) {
  return run(z.object({ pageId: id, title: pageTitleSchema }), input, async (v, store) => {
    const page = await store.getPage({ id: v.pageId });
    if (!page) throw new WikiError("not_found", "Page not found");
    if (!page.revisionId) throw new WikiError("invalid", "Accept or reject this page's proposal before renaming it");
    await store.updatePage({
      pageId: page.id,
      bodyMd: page.bodyMd,
      title: v.title,
      reason: `Renamed from "${page.title}"`,
      citations: page.citations,
      author: human,
      mode: "apply",
      baseRevisionId: page.revisionId,
    });
    return { path: (await store.getPage({ id: page.id }))!.path };
  });
}

export async function movePageAction(input: { wiki: string; pageId: string; newParentId: string | null; index?: number }) {
  const schema = z.object({ pageId: id, newParentId: id.nullable(), index: z.number().int().min(0).optional() });
  return run(schema, input, async (v, store) => {
    await store.movePage({ ...v, author: human });
    return null;
  });
}

export async function deletePageAction(input: { wiki: string; pageId: string }) {
  return run(z.object({ pageId: id }), input, async (v, store) => {
    await store.deletePage({ pageId: v.pageId, author: human });
    return null;
  });
}

export async function acceptRevisionAction(input: { wiki: string; revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v, store) => {
    await store.acceptRevision(v.revisionId);
    return null;
  });
}

export async function rejectRevisionAction(input: { wiki: string; revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v, store) => {
    await store.rejectRevision(v.revisionId);
    return null;
  });
}

/** Bulk accept / reject from the review queue; ordering and per-item failures live in decideProposals. */
export async function decideRevisionsAction(input: { wiki: string; revisionIds: string[]; accept: boolean }) {
  return run(z.object({ revisionIds: z.array(id).min(1).max(500), accept: z.boolean() }), input, (v, store) =>
    decideProposals(store, v.revisionIds, v.accept),
  );
}

export async function revertRevisionAction(input: { wiki: string; revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v, store) => store.revertToRevision(v.revisionId, human));
}
