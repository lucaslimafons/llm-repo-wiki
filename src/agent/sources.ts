import type { SearchHit } from "@/core/contracts";
import { formatSourceHref, githubBlobUrl } from "@/lib/source-links";

export type HitSource = { sourceId: string; url: string; title: string };

/**
 * App URL of a wiki page by display path. Track B owns the page route; this is the one place to
 * change if its shape differs.
 */
export function wikiPageUrl(pagePath: string): string {
  return `/${pagePath.split("/").map(encodeURIComponent).join("/")}`;
}

function lineSuffix(start: number, end: number) {
  return end && end !== start ? `#L${start}-L${end}` : `#L${start}`;
}

/** A search hit as a citable source: GitHub permalink at the exact sha + lines, or a wiki page. */
export function hitToSource(hit: SearchHit): HitSource {
  if (hit.kind === "source") {
    const citation = {
      repo: hit.repo,
      path: hit.path,
      commitSha: hit.commitSha,
      startLine: hit.startLine,
      endLine: hit.endLine,
    };
    return {
      sourceId: formatSourceHref(citation),
      url: githubBlobUrl(citation),
      title: `${hit.repo}/${hit.path}${lineSuffix(hit.startLine, hit.endLine)}`,
    };
  }
  return {
    sourceId: `wiki:${hit.pageId}${hit.headingPath ? `#${hit.headingPath}` : ""}`,
    url: wikiPageUrl(hit.pagePath),
    title: `wiki/${hit.pagePath}${hit.headingPath ? ` › ${hit.headingPath}` : ""}`,
  };
}

/** Dedupe by sourceId, keeping first-seen order (the order the answer will number them in). */
export function dedupeSources<T extends { sourceId: string }>(sources: T[], seen = new Set<string>()): T[] {
  const out: T[] = [];
  for (const s of sources) {
    if (seen.has(s.sourceId)) continue;
    seen.add(s.sourceId);
    out.push(s);
  }
  return out;
}
