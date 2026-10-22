import { splitLines, type ChunkDraft, type ChunkInput } from "./types";

export const LINE_WINDOW = 60;
export const LINE_OVERLAP = 5;

/** Fallback for languages tree-sitter can't parse: fixed windows with a small overlap. */
export function lineWindowChunks(
  input: ChunkInput,
  opts: { kind: "code" | "doc"; lang: string | null; from?: number; to?: number },
): ChunkDraft[] {
  const lines = splitLines(input.text);
  const from = opts.from ?? 1;
  const to = Math.min(opts.to ?? lines.length, lines.length);
  const out: ChunkDraft[] = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(start + LINE_WINDOW - 1, to);
    const piece = trimBlankEdges(lines, start, end);
    if (piece) {
      const content = lines.slice(piece.start - 1, piece.end).join("\n");
      out.push({
        kind: opts.kind,
        lang: opts.lang,
        symbol: null,
        startLine: piece.start,
        endLine: piece.end,
        content,
        embeddedText: `${input.repo}/${input.path}\n\n${content}`,
      });
    }
    if (end === to) break;
    start = end + 1 - LINE_OVERLAP;
  }
  return out;
}

/** Narrows [start, end] (1-based) past blank lines at either edge; null if all blank. */
export function trimBlankEdges(lines: string[], start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s <= e && !lines[s - 1]?.trim()) s++;
  while (e >= s && !lines[e - 1]?.trim()) e--;
  return s <= e ? { start: s, end: e } : null;
}
