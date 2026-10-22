import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Chunk as CodeChunk, Chunker as CodeChunker } from "code-chunk/wasm";
import { lineWindowChunks, trimBlankEdges } from "./lines";
import { splitLines, type ChunkDraft, type ChunkInput } from "./types";

// The grammars are code-chunk's own dependencies, so resolve them from its package, not ours.
const ccRequire = createRequire(createRequire(import.meta.url).resolve("code-chunk/package.json"));
const wasm = (spec: string) => readFile(ccRequire.resolve(spec));

type Loaded = { chunker: CodeChunker; detect: (path: string) => string | null };
let loading: Promise<Loaded> | undefined;

/** WASM-only: the native tree-sitter bindings don't build everywhere. Loaded once per process. */
function load(): Promise<Loaded> {
  loading ??= (async () => {
    const { createChunker, detectLanguage } = await import("code-chunk/wasm");
    const treeSitter = await wasm("web-tree-sitter/web-tree-sitter.wasm");
    const [tsx, javascript, python, go, rust, java] = await Promise.all([
      wasm("tree-sitter-typescript/tree-sitter-tsx.wasm"),
      wasm("tree-sitter-javascript/tree-sitter-javascript.wasm"),
      wasm("tree-sitter-python/tree-sitter-python.wasm"),
      wasm("tree-sitter-go/tree-sitter-go.wasm"),
      wasm("tree-sitter-rust/tree-sitter-rust.wasm"),
      wasm("tree-sitter-java/tree-sitter-java.wasm"),
    ]);
    // 🔴 With the plain TS grammar code-chunk extracts no entities at all (measured), and it maps
    // .tsx to "typescript" anyway. The tsx grammar handles both; it only trips on `<T>x` casts.
    const chunker = await createChunker({ treeSitter, languages: { typescript: tsx, javascript, python, go, rust, java } });
    return { chunker, detect: detectLanguage };
  })();
  return loading;
}

export async function supportsCode(path: string): Promise<boolean> {
  return (await load()).detect(path) !== null;
}

/** AST chunks from code-chunk, with any uncovered non-blank lines backfilled by line windows. */
export async function codeChunks(input: ChunkInput, lang: string | null): Promise<ChunkDraft[]> {
  const raw = await (await load()).chunker.chunk(input.path, input.text);
  const drafts: ChunkDraft[] = raw
    .filter((c) => c.text.trim())
    .map((c) => ({
      kind: "code",
      lang,
      symbol: symbolOf(c),
      // 🔴 code-chunk's lineRange is 0-based inclusive; ours is 1-based inclusive.
      startLine: c.lineRange.start + 1,
      endLine: c.lineRange.end + 1,
      content: c.text,
      embeddedText: `${input.repo}/${input.path}\n${c.contextualizedText}`,
    }));
  return [...drafts, ...backfillGaps(input, lang, drafts)].sort((a, b) => a.startLine - b.startLine);
}

function symbolOf(c: CodeChunk): string | null {
  const scope = c.context.scope.map((s) => s.name).reverse();
  if (scope.length) return scope.join(".");
  const names = c.context.entities
    .filter((e) => e.type !== "import" && e.type !== "export" && e.name !== "<anonymous>")
    .map((e) => e.name);
  return names.length ? names.slice(0, 3).join(", ") : null;
}

/** A citation can only point at lines we indexed, so never let the AST chunker drop any. */
function backfillGaps(input: ChunkInput, lang: string | null, drafts: ChunkDraft[]): ChunkDraft[] {
  const lines = splitLines(input.text);
  const covered = new Uint8Array(lines.length + 2);
  for (const d of drafts) for (let n = d.startLine; n <= d.endLine; n++) covered[n] = 1;
  const out: ChunkDraft[] = [];
  let n = 1;
  while (n <= lines.length) {
    if (covered[n]) {
      n++;
      continue;
    }
    let end = n;
    while (end + 1 <= lines.length && !covered[end + 1]) end++;
    if (trimBlankEdges(lines, n, end)) out.push(...lineWindowChunks(input, { kind: "code", lang, from: n, to: end }));
    n = end + 1;
  }
  return out;
}
