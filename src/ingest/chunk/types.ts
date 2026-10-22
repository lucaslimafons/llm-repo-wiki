export type ChunkDraft = {
  kind: "code" | "doc";
  lang: string | null;
  /** Heading path for docs, scope chain for code. */
  symbol: string | null;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  content: string;
  embeddedText: string;
};

export type ChunkInput = {
  /** "owner/name", used in the embedded header. */
  repo: string;
  path: string;
  text: string;
};

/** code-chunk is v0.1, so every strategy sits behind this seam. */
export interface Chunker {
  chunk(input: ChunkInput): Promise<ChunkDraft[]>;
}

/** ~4 chars per token: good enough to size chunks without shipping a tokenizer. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** Splits into lines without the phantom empty line after a trailing newline. */
export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}
