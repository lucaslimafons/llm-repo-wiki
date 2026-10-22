import { describe, expect, it } from "vitest";
import { decodePageName, encodePageName } from "./filename";

describe("ADO page filenames", () => {
  it.each([
    ["Getting Started", "Getting-Started"],
    ["Pre-commit hooks", "Pre%2Dcommit-hooks"],
    ['Q&A: "why?" <a|b> *', "Q&A%3A-%22why%3F%22-%3Ca%7Cb%3E-%2A"],
    ["100% done", "100%25-done"],
    ["Ünïcode ✓", "Ünïcode-✓"],
  ])("encodes %j as %j and decodes it back", (title, file) => {
    expect(encodePageName(title)).toBe(file);
    expect(decodePageName(file)).toBe(title);
  });

  it("round-trips every reserved character", () => {
    const title = 'a-b c:d<e>f*g?h|i"j%k%2Dl';
    expect(decodePageName(encodePageName(title))).toBe(title);
  });
});
