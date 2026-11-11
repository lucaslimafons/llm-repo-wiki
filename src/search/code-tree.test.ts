import { describe, expect, it } from "vitest";
import { mockGenerateModel } from "@/agent/testing/mock-model";
import { codeFiles, codeOutline, codeTreeSearch, type CodeChunk } from "./code-tree";

const chunk = (path: string, symbol: string | null, startLine: number, endLine: number): CodeChunk => ({
  path,
  symbol,
  startLine,
  endLine,
  content: `// ${path} ${startLine}`,
});

const all: CodeChunk[] = [
  chunk("README.md", null, 1, 20),
  chunk("docs/persist.md", "persist > Usage > Persisting a state partially", 1, 40),
  chunk("docs/persist.md", "persist > Usage > Persisting a state partially", 41, 80),
  chunk("src/vanilla.ts", "createStore", 1, 30),
  chunk("src/vanilla.ts", "Listener", 31, 50),
];

describe("codeOutline", () => {
  it("groups numbered files under their folder, with distinct symbols and doc headings by their last part", () => {
    expect(codeOutline(codeFiles(all)).split("\n")).toEqual([
      "./",
      "  1. README.md",
      "docs/",
      "  2. persist.md: Persisting a state partially",
      "src/",
      "  3. vanilla.ts: createStore, Listener",
    ]);
  });

  it("caps the symbols shown per file", () => {
    const many = Array.from({ length: 13 }, (_, i) => chunk("src/a.ts", `fn${i}`, i + 1, i + 1));
    expect(codeOutline(codeFiles(many))).toContain("fn9, +3 more");
  });
});

describe("codeTreeSearch", () => {
  it("picks files, then returns that file set's chunks in the model's order, ignoring numbers that do not exist", async () => {
    const model = mockGenerateModel([
      { text: JSON.stringify({ files: [3, 3, 99] }), cost: 0.001 },
      { text: JSON.stringify({ sections: [2, 5, 1, 2] }), cost: 0.002 },
    ]);
    const out = await codeTreeSearch("how are listeners notified?", all, { model });
    expect(out.files).toEqual(["src/vanilla.ts"]);
    expect(out.chunks.map((c) => `${c.path}#${c.startLine}`)).toEqual(["src/vanilla.ts#31", "src/vanilla.ts#1"]);
    expect(out.costUsd).toBeCloseTo(0.003);
  });

  it("stops after one call when no file is picked", async () => {
    const model = mockGenerateModel([{ text: JSON.stringify({ files: [] }), cost: 0.001 }]);
    const out = await codeTreeSearch("anything", all, { model });
    expect(out).toEqual({ chunks: [], costUsd: 0.001, files: [] });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
