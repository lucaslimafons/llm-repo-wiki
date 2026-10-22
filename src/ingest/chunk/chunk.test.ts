import { describe, expect, it } from "vitest";
import { createDefaultChunker, markdownChunks } from ".";
import { lineWindowChunks } from "./lines";
import { splitMarkdown } from "./markdown";
import { splitLines, type ChunkDraft } from "./types";

const repo = "acme/widgets";

/** Every non-blank line belongs to some chunk, and each chunk's content is exactly its lines. */
function expectExactCoverage(text: string, drafts: ChunkDraft[], opts: { exactContent?: boolean } = {}) {
  const lines = splitLines(text);
  for (const d of drafts) {
    expect(d.startLine).toBeGreaterThanOrEqual(1);
    expect(d.endLine).toBeLessThanOrEqual(lines.length);
    expect(d.startLine).toBeLessThanOrEqual(d.endLine);
    if (opts.exactContent !== false) expect(d.content).toBe(lines.slice(d.startLine - 1, d.endLine).join("\n"));
  }
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    expect(drafts.some((d) => d.startLine <= i + 1 && i + 1 <= d.endLine), `line ${i + 1} uncovered`).toBe(true);
  });
}

const tsSource = `// Widget utilities.
import { z } from "zod";

/** A widget. */
export class Widget {
  constructor(private readonly name: string) {}

  label(): string {
    return \`widget:\${this.name}\`;
  }
}

export function makeWidget(name: string): Widget {
  return new Widget(name);
}
${Array.from({ length: 40 }, (_, i) => `export const value${i} = ${i} * 2; // padding so the file splits`).join("\n")}
`;

describe("code chunker (code-chunk, WASM)", () => {
  it("converts 0-based line ranges to 1-based inclusive and covers the file", async () => {
    const drafts = await createDefaultChunker().chunk({ repo, path: "src/widget.ts", text: tsSource });
    expect(drafts.length).toBeGreaterThan(1);
    expect(drafts.every((d) => d.kind === "code" && d.lang === "typescript")).toBe(true);
    // The first chunk starts on the first line: a 0-based range would have reported 0.
    expect(Math.min(...drafts.map((d) => d.startLine))).toBe(1);
    const lines = splitLines(tsSource);
    expect(Math.max(...drafts.map((d) => d.endLine))).toBe(lines.length);
    expectExactCoverage(tsSource, drafts, { exactContent: false });
    const widget = drafts.find((d) => d.content.includes("class Widget"))!;
    expect(lines[widget.startLine - 1] + lines.slice(widget.startLine, widget.endLine).join("\n")).toContain("class Widget");
  });

  it("embeds the contextualized text under a repo/path header and keeps raw text as content", async () => {
    const [first] = await createDefaultChunker().chunk({ repo, path: "src/widget.ts", text: tsSource });
    expect(first.embeddedText.startsWith(`${repo}/src/widget.ts\n`)).toBe(true);
    expect(first.content).not.toContain(`${repo}/`);
  });

  it("names the defined entities as the symbol", async () => {
    const drafts = await createDefaultChunker().chunk({ repo, path: "src/widget.ts", text: tsSource });
    expect(drafts.some((d) => d.symbol?.includes("Widget"))).toBe(true);
  });

  it("parses TSX", async () => {
    const text = `export function Hello({ name }: { name: string }) {\n  return <div className="x">{name}</div>;\n}\n`;
    const drafts = await createDefaultChunker().chunk({ repo, path: "src/Hello.tsx", text });
    expect(drafts.length).toBeGreaterThan(0);
    expectExactCoverage(text, drafts, { exactContent: false });
  });
});

describe("line-window fallback", () => {
  it("windows unsupported languages with 1-based ranges and full coverage", async () => {
    const text = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const drafts = await createDefaultChunker().chunk({ repo, path: "scripts/run.rb", text });
    expect(drafts[0]).toMatchObject({ startLine: 1, endLine: 60, lang: "ruby", kind: "code" });
    expect(drafts.at(-1)!.endLine).toBe(150);
    expectExactCoverage(text, drafts);
    // Consecutive windows overlap a little so a match on a boundary is still whole somewhere.
    expect(drafts[1].startLine).toBeLessThan(drafts[0].endLine);
  });

  it("trims blank edges and skips all-blank windows", () => {
    const text = "\n\n\nfoo\nbar\n\n\n";
    const drafts = lineWindowChunks({ repo, path: "a.txt", text }, { kind: "doc", lang: "text" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ startLine: 4, endLine: 5, content: "foo\nbar" });
  });
});

describe("markdown chunker", () => {
  const md = `Intro before any heading.

# Guide

Welcome.

## Setup

Install it.

\`\`\`sh
# not a heading, inside a fence
pnpm install
\`\`\`

### Docker

Run compose.

## Usage

Use it.

# Reference

Docs.
`;

  it("splits by H1-H3 with heading-path breadcrumbs, ignoring # inside code fences", () => {
    const sections = splitMarkdown(md);
    expect(sections.map((s) => s.headingPath)).toEqual([
      null,
      "Guide",
      "Guide > Setup",
      "Guide > Setup > Docker",
      "Guide > Usage",
      "Reference",
    ]);
    const setup = sections[2];
    expect(setup.content).toContain("pnpm install");
    expect(setup.startLine).toBe(7);
    expectExactCoverage(md, markdownChunks({ repo, path: "docs/guide.md", text: md }));
  });

  it("prefixes the embedded text with repo/path > heading path", () => {
    const chunks = markdownChunks({ repo, path: "docs/guide.md", text: md });
    const docker = chunks.find((c) => c.symbol === "Guide > Setup > Docker")!;
    expect(docker.kind).toBe("doc");
    expect(docker.embeddedText.startsWith(`${repo}/docs/guide.md > Guide > Setup > Docker\n\n`)).toBe(true);
    expect(docker.content).toBe("### Docker\n\nRun compose.");
  });

  it("recursively splits a section over the token budget, keeping ranges exact", () => {
    const para = (i: number) => `Paragraph ${i}. ${"lorem ipsum dolor sit amet ".repeat(30)}`;
    const big = `# Big\n\n${Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n")}\n`;
    const chunks = markdownChunks({ repo, path: "docs/big.md", text: big });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.symbol === "Big")).toBe(true);
    expect(chunks.every((c) => c.content.length / 4 <= 800)).toBe(true);
    expectExactCoverage(big, chunks);
  });
});
