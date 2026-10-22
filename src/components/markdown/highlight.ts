import { bundledLanguages, createHighlighter, type BundledLanguage, type ThemedToken } from "shiki";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
let highlighter: Promise<Highlighter> | undefined;

/** One highlighter per server process; grammars load on first use of each language. */
export async function highlightTokens(code: string, lang: string | null): Promise<ThemedToken[][] | null> {
  if (!lang || !(lang in bundledLanguages)) return null;
  highlighter ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] });
  const h = await highlighter;
  const id = lang as BundledLanguage;
  if (!h.getLoadedLanguages().includes(id)) await h.loadLanguage(id);
  return h.codeToTokens(code, {
    lang: id,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  }).tokens;
}
