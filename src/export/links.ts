import { githubBlobUrl, parseSourceHref, parseWikiHref } from "@/lib/source-links";

const LINK_RE = /\[([^\]\n]*)\]\((wiki:[^)\s]+|source:[^)\s]+)\)/g;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

/**
 * Rewrites inline `wiki:` and `source:` links outside fenced code. A link that cannot be
 * resolved (deleted or unpublished page, malformed citation) keeps its text and loses the link,
 * so the export never ships a URL scheme ADO cannot open.
 */
export function rewriteLinks(body: string, wikiPath: (pageId: string) => string | undefined): string {
  let fence: string | null = null;
  return body
    .split("\n")
    .map((line) => {
      const m = FENCE_RE.exec(line);
      if (m) {
        if (fence === null) fence = m[1];
        else if (m[1] === fence) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return line.replace(LINK_RE, (_all, text: string, href: string) => {
        const pageId = parseWikiHref(href);
        if (pageId) {
          const target = wikiPath(pageId);
          return target ? `[${text}](${target})` : text;
        }
        const citation = parseSourceHref(href);
        return citation ? `[${text}](${githubBlobUrl(citation)})` : text;
      });
    })
    .join("\n");
}
