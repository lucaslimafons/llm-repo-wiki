import { describe, expect, it } from "vitest";
import { summarizeActivity } from "./ToolActivity";
import type { ToolUIPartOfWiki } from "./ToolPart";

const part = (tool: string) => ({ type: `tool-${tool}`, toolCallId: tool + Math.random(), state: "output-available", input: {}, output: {} }) as unknown as ToolUIPartOfWiki;

describe("summarizeActivity", () => {
  it("folds a run of steps into one line", () => {
    expect(summarizeActivity([part("searchKnowledge"), part("searchKnowledge"), part("readPage"), part("updatePage")])).toBe(
      "Searched 2× · read 1 page · 1 edit",
    );
  });

  it("pluralises", () => {
    expect(summarizeActivity([part("readPage"), part("readPage"), part("listTree")])).toBe("read 2 pages · 1 step");
  });
});
