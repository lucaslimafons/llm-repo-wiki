import { describe, expect, it } from "vitest";
import { dedupeSources, hitToSource } from "./sources";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("hitToSource", () => {
  it("source hits link to GitHub at the exact sha and lines", () => {
    const s = hitToSource({ kind: "source", chunkId: "c", repo: "acme/api", path: "src/a b.ts", startLine: 5, endLine: 5, commitSha: SHA, symbol: null, content: "", score: 1 });
    expect(s).toEqual({
      sourceId: `source:acme/api/src/a b.ts#L5@${SHA}`,
      url: `https://github.com/acme/api/blob/${SHA}/src/a%20b.ts#L5`,
      title: "acme/api/src/a b.ts#L5",
    });
  });

  it("wiki hits link to the app's page route", () => {
    const s = hitToSource({ kind: "wiki", pageId: "11111111-1111-4111-8111-111111111111", pagePath: "Architecture/Ingest flow", headingPath: "Retries", content: "", score: 1 });
    expect(s).toEqual({
      sourceId: "wiki:11111111-1111-4111-8111-111111111111#Retries",
      url: "/Architecture/Ingest%20flow",
      title: "wiki/Architecture/Ingest flow › Retries",
    });
  });
});

describe("dedupeSources", () => {
  it("keeps first-seen order and honours ids seen earlier in the message", () => {
    const seen = new Set(["a"]);
    expect(dedupeSources([{ sourceId: "b" }, { sourceId: "a" }, { sourceId: "b" }, { sourceId: "c" }], seen)).toEqual([{ sourceId: "b" }, { sourceId: "c" }]);
  });
});
