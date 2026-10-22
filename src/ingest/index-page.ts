import { and, eq } from "drizzle-orm";
import type { JobPayloads, QUEUES } from "@/core/contracts";
import type { Db } from "@/db/client";
import { pageRevisions, pages, wikiChunks } from "@/db/schema";
import { pagePaths } from "@/search/page-path";
// Not "./chunk": that pulls code-chunk's WASM grammars, which only the worker may load.
import { docHeader, splitMarkdown } from "./chunk/markdown";
import type { Embedder } from "./embedder";

export type IndexPageResult = { status: "indexed"; chunks: number } | { status: "skipped"; reason: string };

/** Replaces a page's wiki_chunks with its accepted revision, so search can scope to the wiki. */
export async function indexPage(
  deps: { db: Db; embedder: Embedder },
  { pageId, revisionId }: JobPayloads[typeof QUEUES.indexPage],
): Promise<IndexPageResult> {
  const { db, embedder } = deps;
  const [row] = await db
    .select({ status: pageRevisions.status, body: pageRevisions.bodyMd, current: pages.currentRevisionId })
    .from(pageRevisions)
    .innerJoin(pages, eq(pages.id, pageRevisions.pageId))
    .where(and(eq(pageRevisions.id, revisionId), eq(pageRevisions.pageId, pageId)));
  if (!row) return { status: "skipped", reason: "revision not found" };
  if (row.status !== "accepted") return { status: "skipped", reason: `revision is ${row.status}` };
  // A later accept enqueued its own job; indexing this one would overwrite it with older text.
  if (row.current !== revisionId) return { status: "skipped", reason: "not the current revision" };

  const path = (await pagePaths(db, [pageId])).get(pageId) ?? pageId;
  const sections = splitMarkdown(row.body);
  const vectors = sections.length
    ? await embedder.embed(sections.map((s) => `${docHeader(`wiki/${path}`, s.headingPath)}\n\n${s.content}`))
    : [];

  await db.transaction(async (tx) => {
    await tx.delete(wikiChunks).where(eq(wikiChunks.pageId, pageId));
    if (sections.length) {
      await tx.insert(wikiChunks).values(
        sections.map((s, i) => ({
          pageId,
          revisionId,
          headingPath: s.headingPath,
          content: s.content,
          embeddingModel: embedder.model,
          embedding: vectors[i],
        })),
      );
    }
  });
  return { status: "indexed", chunks: sections.length };
}
