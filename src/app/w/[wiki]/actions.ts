"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { Author } from "@/core/contracts";
import { extractCitations } from "@/wiki/citations";
import { WikiError } from "@/wiki/errors";
import { decideProposals } from "@/wiki/review";
import { wikiStore } from "@/wiki/store";
import { pageTitleSchema } from "@/wiki/title";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const human: Author = { kind: "human" };
const id = z.guid();

/** Validates, runs, refreshes server-rendered parts, and returns expected failures as data. */
async function run<S extends z.ZodType, T>(schema: S, input: unknown, fn: (v: z.infer<S>) => Promise<T>): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  let data: T;
  try {
    data = await fn(parsed.data);
  } catch (err) {
    if (err instanceof WikiError) return { ok: false, error: err.message };
    console.error("[wiki action]", err);
    return { ok: false, error: "Something went wrong. Check the server log." };
  }
  refresh();
  return { ok: true, data };
}

export async function createPageAction(input: { parentId: string | null; title: string }) {
  return run(z.object({ parentId: id.nullable(), title: pageTitleSchema }), input, async (v) => {
    const { pageId } = await wikiStore.createPage({
      parentId: v.parentId,
      title: v.title,
      bodyMd: `# ${v.title}\n`,
      reason: "Created in the editor",
      citations: [],
      author: human,
      mode: "apply",
    });
    const page = await wikiStore.getPage({ id: pageId });
    return { pageId, path: page!.path };
  });
}

export async function savePageAction(input: { pageId: string; bodyMd: string; title?: string; baseRevisionId: string | null }) {
  const schema = z.object({
    pageId: id,
    bodyMd: z.string().max(200_000),
    title: pageTitleSchema.optional(),
    baseRevisionId: id.nullable(),
  });
  return run(schema, input, async (v) => {
    await wikiStore.updatePage({
      pageId: v.pageId,
      bodyMd: v.bodyMd,
      title: v.title,
      reason: "Edited in the editor",
      citations: extractCitations(v.bodyMd),
      author: human,
      mode: "apply",
      baseRevisionId: v.baseRevisionId,
    });
    return (await wikiStore.getPage({ id: v.pageId }))!;
  });
}

export async function renamePageAction(input: { pageId: string; title: string }) {
  return run(z.object({ pageId: id, title: pageTitleSchema }), input, async (v) => {
    const page = await wikiStore.getPage({ id: v.pageId });
    if (!page) throw new WikiError("not_found", "Page not found");
    if (!page.revisionId) throw new WikiError("invalid", "Accept or reject this page's proposal before renaming it");
    await wikiStore.updatePage({
      pageId: page.id,
      bodyMd: page.bodyMd,
      title: v.title,
      reason: `Renamed from "${page.title}"`,
      citations: page.citations,
      author: human,
      mode: "apply",
      baseRevisionId: page.revisionId,
    });
    return { path: (await wikiStore.getPage({ id: page.id }))!.path };
  });
}

export async function movePageAction(input: { pageId: string; newParentId: string | null; index?: number }) {
  const schema = z.object({ pageId: id, newParentId: id.nullable(), index: z.number().int().min(0).optional() });
  return run(schema, input, async (v) => {
    await wikiStore.movePage({ ...v, author: human });
    return null;
  });
}

export async function deletePageAction(input: { pageId: string }) {
  return run(z.object({ pageId: id }), input, async (v) => {
    await wikiStore.deletePage({ pageId: v.pageId, author: human });
    return null;
  });
}

export async function acceptRevisionAction(input: { revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v) => {
    await wikiStore.acceptRevision(v.revisionId);
    return null;
  });
}

export async function rejectRevisionAction(input: { revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v) => {
    await wikiStore.rejectRevision(v.revisionId);
    return null;
  });
}

/** Bulk accept / reject from the review queue; ordering and per-item failures live in decideProposals. */
export async function decideRevisionsAction(input: { revisionIds: string[]; accept: boolean }) {
  return run(z.object({ revisionIds: z.array(id).min(1).max(500), accept: z.boolean() }), input, (v) =>
    decideProposals(wikiStore, v.revisionIds, v.accept),
  );
}

export async function revertRevisionAction(input: { revisionId: string }) {
  return run(z.object({ revisionId: id }), input, async (v) => wikiStore.revertToRevision(v.revisionId, human));
}
