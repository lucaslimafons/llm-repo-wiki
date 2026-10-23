import { describe, expect, it } from "vitest";
import { slugify, uniqueSlugs } from "./slug";

describe("slugify", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["Pre-commit hooks", "pre-commit-hooks"],
    ['Q&A: "why?" <a|b>', "q-a-why-a-b"],
    ["Ünïcode café", "unicode-cafe"],
    ["  --Trim me--  ", "trim-me"],
    ["✓ 日本語", "page"],
  ])("%j → %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("caps length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlugs", () => {
  it("numbers clashes in sibling order and never uses readme", () => {
    expect(uniqueSlugs(["Setup", "setup!", "README", "Readme", "Setup"])).toEqual(["setup", "setup-2", "readme-2", "readme-3", "setup-3"]);
  });
});
