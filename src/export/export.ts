import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pageRevisions, pages } from "@/db/schema";
import { childrenOf, type OutlineRow } from "@/wiki/tree";
import { encodePageName } from "./filename";
import { rewriteLinks } from "./links";

type ExportPage = OutlineRow & { bodyMd: string };

/**
 * The Azure DevOps layout as relative path → file content. Only pages with an accepted current
 * revision are exported, and a page under an unpublished parent is left out with it.
 * Pure and sorted, so the same database always produces byte-identical files.
 */
export function buildExport(rows: ExportPage[]): Map<string, string> {
  const published = rows.filter((r) => r.currentRevisionId !== null);
  const files = new Map<string, string>();
  const adoPath = new Map<string, string>();

  const place = (parentId: string | null, dir: string) => {
    const kids = childrenOf(published, parentId) as ExportPage[];
    if (kids.length === 0) return;
    const names = kids.map((k) => encodePageName(k.title));
    files.set(posix.join(dir, ".order"), names.join("\n") + "\n");
    kids.forEach((k, i) => {
      adoPath.set(k.id, `/${posix.join(dir, names[i])}`);
      place(k.id, posix.join(dir, names[i]));
    });
  };
  place(null, "");

  for (const page of published) {
    const path = adoPath.get(page.id);
    if (!path) continue; // unreachable: an ancestor is unpublished
    const body = rewriteLinks(page.bodyMd.replace(/\r\n?/g, "\n"), (id) => adoPath.get(id));
    files.set(`${path.slice(1)}.md`, body.endsWith("\n") ? body : `${body}\n`);
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export async function loadExportPages(db: Db): Promise<ExportPage[]> {
  const rows = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      sortKey: pages.sortKey,
      stale: pages.stale,
      currentRevisionId: pages.currentRevisionId,
      bodyMd: pageRevisions.bodyMd,
      status: pageRevisions.status,
    })
    .from(pages)
    .leftJoin(pageRevisions, eq(pageRevisions.id, pages.currentRevisionId));
  return rows.map((r) => ({
    ...r,
    currentRevisionId: r.status === "accepted" ? r.currentRevisionId : null,
    bodyMd: r.bodyMd ?? "",
    hasPendingProposal: false,
  }));
}

/** Writes the export. A non-empty `outDir` is refused unless `force`, which keeps only `.git`. */
export async function exportWiki(db: Db, outDir: string, opts: { force?: boolean } = {}) {
  const existing = await readdir(outDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const others = existing.filter((e) => e !== ".git");
  if (others.length > 0) {
    if (!opts.force) throw new Error(`${outDir} is not empty; pass --force to replace its contents (.git is kept)`);
    for (const entry of others) await rm(join(outDir, entry), { recursive: true, force: true });
  }
  const files = buildExport(await loadExportPages(db));
  await mkdir(join(outDir, ".attachments"), { recursive: true });
  for (const [rel, content] of files) {
    const target = join(outDir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { files: files.size };
}
