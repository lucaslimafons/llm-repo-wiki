import type { TreeNode } from "@/core/contracts";
import { joinPath } from "./title";

/** One row per page: enough to build the tree, resolve paths and check structural rules. */
export type OutlineRow = {
  id: string;
  parentId: string | null;
  title: string;
  sortKey: number;
  stale: boolean;
  currentRevisionId: string | null;
  hasPendingProposal: boolean;
};

/** Sibling order: sort_key, then title and id so equal keys still order deterministically. */
export function compareSiblings(a: OutlineRow, b: OutlineRow): number {
  return a.sortKey - b.sortKey || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function childrenOf(rows: OutlineRow[], parentId: string | null): OutlineRow[] {
  return rows.filter((r) => r.parentId === parentId).sort(compareSiblings);
}

/** id → "Parent/Child". A parent missing from `rows` (never expected) roots the page. */
export function computePaths(rows: OutlineRow[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const paths = new Map<string, string>();
  const resolve = (row: OutlineRow, depth: number): string => {
    const known = paths.get(row.id);
    if (known !== undefined) return known;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    if (depth > rows.length) throw new Error("wiki tree has a cycle");
    const path = joinPath(parent ? resolve(parent, depth + 1) : null, row.title);
    paths.set(row.id, path);
    return path;
  };
  for (const row of rows) resolve(row, 0);
  return paths;
}

export function buildTree(rows: OutlineRow[]): TreeNode[] {
  const paths = computePaths(rows);
  const build = (parentId: string | null): TreeNode[] =>
    childrenOf(rows, parentId).map((r) => ({
      id: r.id,
      title: r.title,
      path: paths.get(r.id)!,
      sortKey: r.sortKey,
      stale: r.stale,
      hasPendingProposal: r.hasPendingProposal,
      children: build(r.id),
    }));
  return build(null);
}

/** Every descendant id of `id` (not including it). */
export function descendantIds(rows: OutlineRow[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const r of rows) {
      if (r.parentId !== pid || out.has(r.id)) continue;
      out.add(r.id);
      walk(r.id);
    }
  };
  walk(id);
  return out;
}
