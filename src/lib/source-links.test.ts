import { describe, expect, it } from "vitest";
import { formatSourceHref, githubBlobUrl, parseSourceHref, parseWikiHref } from "./source-links";

const c = { repo: "vercel/ai", path: "packages/ai/src/index.ts", commitSha: "abc1234", startLine: 10, endLine: 40 };

describe("source links", () => {
  it("round-trips a citation", () => {
    expect(parseSourceHref(formatSourceHref(c))).toEqual(c);
  });

  it("builds a permalink at the commit", () => {
    expect(githubBlobUrl(c)).toBe("https://github.com/vercel/ai/blob/abc1234/packages/ai/src/index.ts#L10-L40");
  });

  it("rejects traversal and malformed hrefs", () => {
    expect(parseSourceHref("source:a/b/../../etc/passwd@abc1234")).toBeNull();
    expect(parseSourceHref("source:a/b/x.ts")).toBeNull();
    expect(parseSourceHref("javascript:alert(1)")).toBeNull();
  });

  it("parses wiki links by uuid only", () => {
    expect(parseWikiHref("wiki:3f2b9c1e-8a4d-4c2e-9b1a-0d5e6f7a8b9c")).toBe("3f2b9c1e-8a4d-4c2e-9b1a-0d5e6f7a8b9c");
    expect(parseWikiHref("wiki:../secret")).toBeNull();
  });
});
