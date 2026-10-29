import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import { githubBlobUrl, parseSourceHref, parseWikiHref } from "@/lib/source-links";
import { wikiBase, wikiRoute } from "@/wiki/routes";

/** The slice of hast these plugins touch; avoids depending on @types/hast directly. */
export type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  value?: string;
};

/** id → display path. Omitted (chat), a wiki link goes through /page/<id>, which redirects. */
export type WikiPaths = Record<string, string>;


/** Only http(s), relative and #fragment hrefs survive: sanitize drops every other scheme. */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ["http", "https"] },
};

/** ADO writes diagrams as `::: mermaid … :::`; turn them into fences so one renderer handles both. */
export function normalizeAdoMarkdown(md: string): string {
  return md.replace(/^:::[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm, "```mermaid\n$1\n```");
}

export function textOf(node: HNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function walk(node: HNode, fn: (n: HNode, parent: HNode | null, index: number) => void, parent: HNode | null = null, index = 0) {
  fn(node, parent, index);
  node.children?.forEach((c, i) => walk(c, fn, node, i));
}

/**
 * Before sanitize: rewrite `wiki:` and `source:` hrefs into routes and GitHub permalinks, which
 * sanitize then keeps. A `wiki:` id missing from a provided map loses its href (dead link).
 */
export function rehypeWikiLinks(opts: { wikiSlug: string; wikiPaths?: WikiPaths }) {
  return (tree: HNode) => {
    walk(tree, (n) => {
      if (n.tagName !== "a" || typeof n.properties?.href !== "string") return;
      const href = n.properties.href;
      const pageId = parseWikiHref(href);
      if (pageId) {
        const path = opts.wikiPaths ? opts.wikiPaths[pageId] : undefined;
        if (path !== undefined) n.properties.href = wikiRoute(opts.wikiSlug, path);
        else if (opts.wikiPaths) delete n.properties.href;
        else n.properties.href = `${wikiBase(opts.wikiSlug)}/page/${pageId}`;
        return;
      }
      if (href.startsWith("source:")) {
        const c = parseSourceHref(href);
        if (c) n.properties.href = githubBlobUrl(c);
        else delete n.properties.href;
      }
    });
  };
}

const PREFIX = "user-content-";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/**
 * After sanitize, so the ids and TOC links are ours: headings get `user-content-<slug>` ids
 * (the same clobber prefix sanitize uses), `#frag` links follow, and `[[_TOC_]]` becomes a list.
 */
export function rehypeHeadingsAndToc() {
  return (tree: HNode) => {
    const seen = new Map<string, number>();
    const headings: { depth: number; text: string; id: string }[] = [];
    walk(tree, (n) => {
      const m = n.tagName ? /^h([1-6])$/.exec(n.tagName) : null;
      if (m) {
        const text = textOf(n);
        const base = slugify(text) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = PREFIX + (count ? `${base}-${count}` : base);
        n.properties = { ...n.properties, id };
        headings.push({ depth: Number(m[1]), text, id });
      } else if (n.tagName === "a" && typeof n.properties?.href === "string") {
        const href = n.properties.href;
        if (href.startsWith("#") && !href.startsWith(`#${PREFIX}`) && href.length > 1) {
          n.properties.href = `#${PREFIX}${href.slice(1)}`;
        }
      }
    });
    walk(tree, (n, parent, index) => {
      if (!parent || n.tagName !== "p") return;
      const t = textOf(n).trim();
      if (t !== "[[_TOC_]]" && t !== "[[TOC]]") return;
      parent.children![index] = tocNode(headings);
    });
  };
}

function el(tagName: string, properties: Record<string, unknown>, children: HNode[]): HNode {
  return { type: "element", tagName, properties, children };
}

function tocNode(headings: { depth: number; text: string; id: string }[]): HNode {
  const min = Math.min(...headings.map((h) => h.depth), 6);
  const items = headings.map((h) =>
    el("li", { className: ["toc-item"], style: `margin-left:${(h.depth - min) * 1}rem` }, [
      el("a", { href: `#${h.id}` }, [{ type: "text", value: h.text }]),
    ]),
  );
  return el("nav", { ariaLabel: "Table of contents", className: ["toc"] }, [el("ul", {}, items)]);
}
