import { describe, expect, it } from "vitest";
import { extractCitations } from "./citations";

describe("extractCitations", () => {
  it("collects valid source: links once each and ignores everything else", () => {
    const md = [
      "[a](source:acme/api/src/a.ts#L1-L4@abc1234) and again [a](source:acme/api/src/a.ts#L1-L4@abc1234)",
      "[b](source:acme/api/b.md@abc1234) [bad](source:acme/api/../x@abc1234) [w](wiki:x) [h](https://x.y)",
    ].join("\n");
    expect(extractCitations(md)).toEqual([
      { repo: "acme/api", path: "src/a.ts", commitSha: "abc1234", startLine: 1, endLine: 4 },
      { repo: "acme/api", path: "b.md", commitSha: "abc1234", startLine: undefined, endLine: undefined },
    ]);
  });
});
