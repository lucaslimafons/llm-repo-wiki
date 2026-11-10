import { describe, expect, it } from "vitest";
import { mockGenerateModel } from "@/agent/testing/mock-model";
import { numberCitations, outline, treeSearch, type TreePage } from "./tree";

const sha = "382d29c485e67018c06e75ec7235130d0968522c";
const src = (repo: string, path: string, a: number, b: number) => `[${path}](source:${repo}/${path}#L${a}-L${b}@${sha})`;

const pages: TreePage[] = [
  {
    path: "Core/Store",
    body: [
      "# Store",
      "",
      `The vanilla store keeps state in a closure ${src("acme/lib", "src/vanilla.ts", 1, 20)} and see [Hooks](wiki:00000000-0000-4000-8000-000000000000).`,
      "",
      "## Subscribing",
      `Listeners run on every change ${src("acme/lib", "src/vanilla.ts", 30, 40)}.`,
      "## Other repo",
      `Unrelated ${src("other/repo", "x.ts", 1, 2)}.`,
    ].join("\n"),
  },
  { path: "Middlewares/Persist", body: `# Persist\n\n- a list item is not a lead\n\nSaves state ${src("acme/lib", "src/persist.ts", 5, 9)}.` },
];

describe("outline", () => {
  it("lists each page with its lead sentence and section headings, links reduced to their text", () => {
    expect(outline(pages).split("\n")).toEqual([
      "1. Core/Store | The vanilla store keeps state in a closure src/vanilla.ts and see Hooks. | sections: Subscribing; Other repo",
      "2. Middlewares/Persist | Saves state src/persist.ts.",
    ]);
  });
});

describe("numberCitations", () => {
  it("numbers source links in order, keeps wiki link text, drops other repos, and wraps pages as data", () => {
    const { text, citations } = numberCitations(pages, "acme/lib");
    expect(citations.map((c) => `${c.path}#${c.startLine}-${c.endLine}`)).toEqual(["src/vanilla.ts#1-20", "src/vanilla.ts#30-40", "src/persist.ts#5-9"]);
    expect(text).toContain("[c2 src/vanilla.ts#L30-L40]");
    expect(text).toContain("see Hooks.");
    expect(text).not.toContain("other/repo");
    expect(text).toContain('<retrieved source="Middlewares/Persist">');
  });
});

describe("treeSearch", () => {
  it("picks pages, then returns the ranked citations, ignoring numbers that do not exist", async () => {
    const model = mockGenerateModel([
      { text: JSON.stringify({ pages: [1, 1, 9] }), cost: 0.001 },
      { text: JSON.stringify({ citations: [2, 7, 1, 2] }), cost: 0.002 },
    ]);
    const out = await treeSearch("how are listeners notified?", pages, { model, repo: "acme/lib" });
    expect(out.pages).toEqual(["Core/Store"]);
    expect(out.citations.map((c) => `${c.path}#${c.startLine}`)).toEqual(["src/vanilla.ts#30", "src/vanilla.ts#1"]);
    expect(out.costUsd).toBeCloseTo(0.003);
  });

  it("stops after one call when the chosen pages cite nothing", async () => {
    const model = mockGenerateModel([{ text: JSON.stringify({ pages: [] }), cost: 0.001 }]);
    const out = await treeSearch("anything", pages, { model });
    expect(out).toEqual({ citations: [], costUsd: 0.001, pages: [] });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
