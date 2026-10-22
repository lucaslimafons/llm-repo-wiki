import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pageRevisions, pages, repos, revisionSources, sourceFiles, wikiLog } from "@/db/schema";
import { parseWikiHref } from "@/lib/source-links";
import { computePaths, type OutlineRow } from "./tree";

export type LintFinding =
  | { kind: "orphan"; pageId: string; path: string }
  | { kind: "dead_link"; pageId: string; path: string; target: string }
  | { kind: "no_citations"; pageId: string; path: string }
  | { kind: "deleted_citation"; pageId: string; path: string; repo: string; file: string }
  | { kind: "stale"; pageId: string; path: string };

const LINK_HREF_RE = /\]\(\s*<?(wiki:[^)\s>]+)/g;

export function wikiLinkTargets(bodyMd: string): string[] {
  return [...bodyMd.matchAll(LINK_HREF_RE)].map((m) => parseWikiHref(m[1]) ?? m[1]);
}

/** Deterministic checks over published pages (an accepted current revision). No model involved. */
export async function findLintIssues(db: Db): Promise<LintFinding[]> {
  const rows = await db
    .select({
      id: pages.id,
      parentId: pages.parentId,
      title: pages.title,
      sortKey: pages.sortKey,
      stale: pages.stale,
      currentRevisionId: pages.currentRevisionId,
      bodyMd: pageRevisions.bodyMd,
      sources: sql<number>`(select count(*)::int from revision_sources s where s.revision_id = "pages"."current_revision_id")`,
    })
    .from(pages)
    .leftJoin(pageRevisions, eq(pageRevisions.id, pages.currentRevisionId));
  const outline: OutlineRow[] = rows.map((r) => ({ ...r, hasPendingProposal: false }));
  const paths = computePaths(outline);
  const published = rows.filter((r) => r.currentRevisionId !== null);
  const exists = new Set(rows.map((r) => r.id));
  const inbound = new Set<string>();
  const findings: LintFinding[] = [];

  for (const page of published) {
    const path = paths.get(page.id)!;
    for (const target of wikiLinkTargets(page.bodyMd ?? "")) {
      if (exists.has(target)) {
        if (target !== page.id) inbound.add(target);
      } else findings.push({ kind: "dead_link", pageId: page.id, path, target });
    }
    if (page.sources === 0) findings.push({ kind: "no_citations", pageId: page.id, path });
    if (page.stale) findings.push({ kind: "stale", pageId: page.id, path });
  }
  for (const page of published) {
    if (page.parentId !== null && !inbound.has(page.id)) {
      findings.push({ kind: "orphan", pageId: page.id, path: paths.get(page.id)! });
    }
  }

  // Only repos that finished a sync: before that, source_files is legitimately empty.
  const missing = await db
    .select({
      pageId: pages.id,
      repo: sql<string>`${repos.owner} || '/' || ${repos.name}`,
      file: revisionSources.path,
    })
    .from(pages)
    .innerJoin(revisionSources, eq(revisionSources.revisionId, pages.currentRevisionId))
    .innerJoin(repos, and(eq(repos.id, revisionSources.repoId), isNotNull(repos.syncedSha)))
    .leftJoin(sourceFiles, and(eq(sourceFiles.repoId, revisionSources.repoId), eq(sourceFiles.path, revisionSources.path)))
    .where(sql`${sourceFiles.path} is null`)
    .groupBy(pages.id, repos.owner, repos.name, revisionSources.path);
  for (const m of missing) {
    findings.push({ kind: "deleted_citation", pageId: m.pageId, path: paths.get(m.pageId)!, repo: m.repo, file: m.file });
  }

  const order = ["dead_link", "deleted_citation", "stale", "no_citations", "orphan"];
  return findings.sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path),
  );
}

/** The lint-wiki job: every finding becomes a `lint.finding` row in the append-only log. */
export async function runLint(db: Db): Promise<LintFinding[]> {
  const findings = await findLintIssues(db);
  await db.transaction(async (tx) => {
    for (const f of findings) {
      await tx.insert(wikiLog).values({ actor: "agent", action: "lint.finding", pageId: f.pageId, details: f });
    }
    await tx.insert(wikiLog).values({ actor: "agent", action: "lint.run", details: { findings: findings.length } });
  });
  return findings;
}
