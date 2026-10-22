import type { CSSProperties } from "react";
import { highlightTokens } from "./highlight";
import { Markdown, type MarkdownProps } from "./Markdown";

function toStyle(css: Record<string, string> | undefined): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(css ?? {})) {
    out[k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as CSSProperties;
}

/** Tokens carry --shiki-light/--shiki-dark only, so the theme follows the color scheme. */
async function HighlightedCode({ code, lang }: { code: string; lang: string | null }) {
  const lines = await highlightTokens(code, lang).catch(() => null);
  if (!lines) return <pre><code>{code}</code></pre>;
  return (
    <pre data-lang={lang ?? undefined}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="block min-h-6">
            {line.map((t, j) => (
              <span
                key={j}
                style={toStyle(t.htmlStyle)}
                className="text-(--shiki-light) dark:text-(--shiki-dark)"
              >
                {t.content}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** Server-only page renderer: Markdown plus Shiki, which never reaches the client bundle. */
export function WikiMarkdown(props: Omit<MarkdownProps, "renderCode">) {
  return <Markdown {...props} renderCode={(code, lang) => <HighlightedCode code={code} lang={lang} />} />;
}
