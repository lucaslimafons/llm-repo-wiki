import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pageRevisions, pages } from "@/db/schema";
import { childrenOf, type OutlineRow } from "@/wiki/tree";
import { rewriteLinks } from "./links";
import { uniqueSlugs } from "./slug";

type ExportPage = OutlineRow & { bodyMd: string };

/** A link from one exported file to another, relative so the folder works anywhere it is copied. */
function relativeLink(fromFile: string, toFile: string): string {
  const rel = posix.relative(posix.dirname(fromFile), toFile);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

const escapeLinkText = (text: string) => text.replace(/[[\]\\]/g, (ch) => `\\${ch}`);

/**
 * The wiki as plain markdown, path → content: a leaf page is `slug.md`, a page with subpages is
 * `slug/README.md` (GitHub renders it as the folder's page), and the root README.md is the index.
 * Only accepted pages are exported, and an unpublished page takes its subtree with it. Pure and
 * sorted, so the same database always produces byte-identical files.
 */
export function buildExport(rows: ExportPage[]): Map<string, string> {
  const published = rows.filter((r) => r.currentRevisionId !== null);
  const fileOf = new Map<string, string>();
  const index: string[] = [];

  const place = (parentId: string | null, dir: string, depth: number) => {
    const kids = childrenOf(published, parentId) as ExportPage[];
    const slugs = uniqueSlugs(kids.map((k) => k.title));
    kids.forEach((k, i) => {
      const hasKids = childrenOf(published, k.id).length > 0;
      const file = hasKids ? posix.join(dir, slugs[i], "README.md") : posix.join(dir, `${slugs[i]}.md`);
      fileOf.set(k.id, file);
      index.push(`${"  ".repeat(depth)}- [${escapeLinkText(k.title)}](${relativeLink("README.md", file)})`);
      if (hasKids) place(k.id, posix.join(dir, slugs[i]), depth + 1);
    });
  };
  place(null, "", 0);

  const files = new Map<string, string>();
  files.set("README.md", `# Wiki\n\n${index.length ? index.join("\n") : "No accepted pages yet."}\n`);
  for (const page of published) {
    const file = fileOf.get(page.id);
    if (!file) continue; // unreachable: an ancestor is unpublished
    const linked = rewriteLinks(page.bodyMd.replace(/\r\n?/g, "\n").trim(), (id) => {
      const target = fileOf.get(id);
      return target ? relativeLink(file, target) : undefined;
    });
    const body = /^# /.test(linked) ? linked : `# ${page.title}${linked ? `\n\n${linked}` : ""}`;
    files.set(file, `${body}\n`);
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
  for (const [rel, content] of files) {
    const target = join(outDir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { files: files.size };
}
