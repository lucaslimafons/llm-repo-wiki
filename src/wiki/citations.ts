import type { Citation } from "@/core/contracts";
import { formatSourceHref, parseSourceHref } from "@/lib/source-links";

const SOURCE_LINK_RE = /\]\(\s*<?(source:[^)\s>]+)/g;

/** A human edit's citations are the `source:` links in its body, deduplicated in order. */
export function extractCitations(bodyMd: string): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const m of bodyMd.matchAll(SOURCE_LINK_RE)) {
    const c = parseSourceHref(m[1]);
    if (!c) continue;
    const key = formatSourceHref(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
