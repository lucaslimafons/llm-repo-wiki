import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Mermaid } from "./Mermaid";
import {
  normalizeAdoMarkdown,
  rehypeHeadingsAndToc,
  rehypeWikiLinks,
  sanitizeSchema,
  textOf,
  type HNode,
  type WikiPaths,
} from "./plugins";

export type CodeRenderer = (code: string, lang: string | null) => ReactNode;

export type MarkdownProps = {
  children: string;
  /** The wiki whose routes `wiki:` links resolve to. */
  wikiSlug: string;
  /** id → display path, to link `wiki:` ids directly and mark dead ones. Omit in chat. */
  wikiPaths?: WikiPaths;
  className?: string;
  /** Server-only highlighting hook (see WikiMarkdown); plain <pre> when omitted. */
  renderCode?: CodeRenderer;
};

const PROSE = [
  "min-w-0 text-[15px] leading-7 break-words",
  "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-line [&_h2]:pb-1 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold",
  "[&>*:first-child]:mt-0 [&_p]:my-3 [&_li]:my-1",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-4 [&_blockquote]:text-muted",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface-2 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.875em]",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-2 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-6",
  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-1.5",
  "[&_hr]:my-6 [&_hr]:border-line [&_img]:max-w-full",
  "[&_.toc]:my-4 [&_.toc]:rounded-md [&_.toc]:border [&_.toc]:border-line [&_.toc]:bg-surface-2 [&_.toc]:px-4 [&_.toc]:py-2 [&_.toc_ul]:my-0 [&_.toc_ul]:list-none [&_.toc_ul]:pl-0 [&_.toc_li]:my-0.5",
].join(" ");

function codeOf(node: HNode | undefined): { code: string; lang: string | null } | null {
  const child = node?.children?.find((c) => c.tagName === "code");
  if (!child) return null;
  const cls = child.properties?.className;
  const first = Array.isArray(cls) ? cls.find((c) => String(c).startsWith("language-")) : undefined;
  return { code: textOf(child).replace(/\n$/, ""), lang: first ? String(first).slice("language-".length) : null };
}

function components(renderCode?: CodeRenderer): Components {
  return {
    a({ href, children, node: _node, ...rest }) {
      if (!href) {
        return (
          <span className="text-danger line-through" title="Link to a missing page">
            {children}
          </span>
        );
      }
      if (/^https?:\/\//i.test(href)) {
        return (
          <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      if (href.startsWith("/")) return <Link href={href}>{children}</Link>;
      return (
        <a {...rest} href={href}>
          {children}
        </a>
      );
    },
    pre({ node, children }) {
      const block = codeOf(node as HNode | undefined);
      if (block?.lang === "mermaid") return <Mermaid chart={block.code} />;
      if (block && renderCode) return renderCode(block.code, block.lang);
      return <pre>{children}</pre>;
    },
  };
}

/**
 * Sanitized GFM markdown with wiki/source link resolution, `[[_TOC_]]` and lazy mermaid.
 * Safe in client components (chat) and server components alike; never renders raw HTML.
 */
export function Markdown({ children, wikiSlug, wikiPaths, className, renderCode }: MarkdownProps) {
  return (
    <div className={className ? `${PROSE} ${className}` : PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeWikiLinks, { wikiSlug, wikiPaths }], [rehypeSanitize, sanitizeSchema], rehypeHeadingsAndToc]}
        components={components(renderCode)}
      >
        {normalizeAdoMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
