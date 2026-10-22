import { codeChunks, supportsCode } from "./code";
import { isDocLang, detectLang } from "./lang";
import { lineWindowChunks } from "./lines";
import { docHeader, splitMarkdown } from "./markdown";
import type { ChunkDraft, ChunkInput, Chunker } from "./types";

export type { ChunkDraft, ChunkInput, Chunker } from "./types";
export { detectLang } from "./lang";
export { docHeader } from "./markdown";

export function markdownChunks(input: ChunkInput, lang: string | null = "markdown"): ChunkDraft[] {
  const location = `${input.repo}/${input.path}`;
  return splitMarkdown(input.text).map((s) => ({
    kind: "doc",
    lang,
    symbol: s.headingPath,
    startLine: s.startLine,
    endLine: s.endLine,
    content: s.content,
    embeddedText: `${docHeader(location, s.headingPath)}\n\n${s.content}`,
  }));
}

/** Markdown → heading split; tree-sitter languages → code-chunk; everything else → line windows. */
export function createDefaultChunker(): Chunker {
  return {
    async chunk(input) {
      const lang = detectLang(input.path);
      if (lang === "markdown") return markdownChunks(input, lang);
      if (await supportsCode(input.path)) {
        try {
          return await codeChunks(input, lang);
        } catch (err) {
          // A grammar that chokes on one file must not cost us the file.
          console.warn(`[chunk] code-chunk failed on ${input.path}, using line windows:`, (err as Error).message);
        }
      }
      return lineWindowChunks(input, { kind: isDocLang(lang) ? "doc" : "code", lang });
    },
  };
}
