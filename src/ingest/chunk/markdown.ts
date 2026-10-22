import { trimBlankEdges } from "./lines";
import { approxTokens, splitLines } from "./types";

export const MD_MAX_TOKENS = 800;

/** Prefix for doc chunks' embedded text: "<repo>/<path> > <heading path>". */
export function docHeader(location: string, headingPath: string | null): string {
  return headingPath ? `${location} > ${headingPath}` : location;
}

export type MarkdownSection = {
  /** "Setup > Docker", or null for text before the first heading. */
  headingPath: string | null;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  content: string;
};

const HEADING_RE = /^ {0,3}(#{1,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** Splits on H1–H3 (outside code fences), then recursively splits sections over the token budget. */
export function splitMarkdown(text: string, maxTokens = MD_MAX_TOKENS): MarkdownSection[] {
  const lines = splitLines(text);
  const inFence = fenceMask(lines);
  const trail: string[] = [];
  const sections: { headingPath: string | null; start: number; end: number }[] = [];
  let current = { headingPath: null as string | null, start: 1 };

  for (let i = 0; i < lines.length; i++) {
    const m = inFence[i] ? null : HEADING_RE.exec(lines[i]);
    if (!m) continue;
    if (i > 0) sections.push({ ...current, end: i });
    const level = m[1].length;
    trail.length = level - 1;
    trail[level - 1] = m[2].trim();
    current = { headingPath: trail.filter(Boolean).join(" > "), start: i + 1 };
  }
  sections.push({ ...current, end: lines.length });

  const out: MarkdownSection[] = [];
  for (const s of sections) {
    for (const piece of splitRange(lines, inFence, s.start, s.end, maxTokens)) {
      out.push({
        headingPath: s.headingPath,
        startLine: piece.start,
        endLine: piece.end,
        content: lines.slice(piece.start - 1, piece.end).join("\n"),
      });
    }
  }
  return out;
}

function fenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = FENCE_RE.exec(line);
    if (fence) {
      mask.push(true);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      mask.push(true);
    } else mask.push(false);
  }
  return mask;
}

type Range = { start: number; end: number };

/** Packs paragraphs (a fenced block counts as one) up to the budget; an oversized one splits by line. */
function splitRange(lines: string[], inFence: boolean[], start: number, end: number, maxTokens: number): Range[] {
  const whole = trimBlankEdges(lines, start, end);
  if (!whole) return [];
  const size = (r: Range) => approxTokens(lines.slice(r.start - 1, r.end).join("\n"));
  if (size(whole) <= maxTokens) return [whole];

  const blocks: Range[] = [];
  let b: Range | null = null;
  for (let n = whole.start; n <= whole.end; n++) {
    const blank = !lines[n - 1].trim() && !inFence[n - 1];
    if (blank) {
      if (b) blocks.push(b);
      b = null;
    } else if (b) b.end = n;
    else b = { start: n, end: n };
  }
  if (b) blocks.push(b);

  const units = blocks.flatMap((blk) =>
    size(blk) <= maxTokens ? [blk] : Array.from({ length: blk.end - blk.start + 1 }, (_, k) => ({ start: blk.start + k, end: blk.start + k })),
  );

  const out: Range[] = [];
  let acc: Range | null = null;
  for (const u of units) {
    if (acc && size({ start: acc.start, end: u.end }) <= maxTokens) acc.end = u.end;
    else {
      if (acc) out.push(acc);
      acc = { ...u };
    }
  }
  if (acc) out.push(acc);
  return out;
}
