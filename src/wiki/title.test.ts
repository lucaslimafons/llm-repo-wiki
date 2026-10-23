import { describe, expect, it } from "vitest";
import { pageTitleSchema } from "./title";

describe("pageTitleSchema", () => {
  it.each([
    ["Getting Started", "Getting Started"],
    ["  Setup  ", "Setup"],
    ["C++ & Rust: notes?", "C++ & Rust: notes?"],
    ["v1.2 release", "v1.2 release"],
    ["x".repeat(235), "x".repeat(235)],
  ])("accepts %j", (input, out) => {
    expect(pageTitleSchema.parse(input)).toBe(out);
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["a/b", "slash"],
    ["a\\b", "backslash"],
    ["C#", "hash"],
    [".hidden", "leading period"],
    ["etc.", "trailing period"],
    ["tab\there", "control char"],
    ["line\nbreak", "newline"],
    ["x".repeat(236), "over 235"],
  ])("rejects %j (%s)", (input) => {
    expect(pageTitleSchema.safeParse(input).success).toBe(false);
  });
});
