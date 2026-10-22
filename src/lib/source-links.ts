import type { Citation } from "@/core/contracts";

/**
 * Citation and wiki-link formats shared by the agent (writes them), the renderer (resolves them)
 * and the export (rewrites them).
 *   source:<owner>/<name>/<path>#L<start>-L<end>@<sha>
 *   wiki:<page uuid>
 */
const SOURCE_RE = /^source:([^/\s]+)\/([^/\s]+)\/([^#@\s]+)(?:#L(\d+)(?:-L(\d+))?)?@([0-9a-f]{7,40})$/i;
const WIKI_RE = /^wiki:([0-9a-f-]{36})$/i;

export function formatSourceHref(c: Citation): string {
  const lines = c.startLine ? `#L${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-L${c.endLine}` : ""}` : "";
  return `source:${c.repo}/${c.path}${lines}@${c.commitSha}`;
}

export function parseSourceHref(href: string): Citation | null {
  const m = SOURCE_RE.exec(href);
  if (!m) return null;
  const [, owner, name, path, start, end, sha] = m;
  if (path.split("/").some((seg) => seg === ".." || seg === "")) return null;
  return {
    repo: `${owner}/${name}`,
    path,
    commitSha: sha,
    startLine: start ? Number(start) : undefined,
    endLine: end ? Number(end) : start ? Number(start) : undefined,
  };
}

/** Permalink at the exact commit, so a citation never drifts as the branch moves. */
export function githubBlobUrl(c: Citation): string {
  const encodedPath = c.path.split("/").map(encodeURIComponent).join("/");
  const lines = c.startLine ? `#L${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-L${c.endLine}` : ""}` : "";
  return `https://github.com/${c.repo}/blob/${c.commitSha}/${encodedPath}${lines}`;
}

export function formatWikiHref(pageId: string): string {
  return `wiki:${pageId}`;
}

export function parseWikiHref(href: string): string | null {
  return WIKI_RE.exec(href)?.[1] ?? null;
}
