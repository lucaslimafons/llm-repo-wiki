import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/core/contracts";
import { rerankHits } from "./rerank";

const hit = (path: string): SearchHit => ({
  kind: "source", chunkId: path, repo: "a/b", path, startLine: 1, endLine: 2, commitSha: "abc1234", symbol: null, content: path, score: 0,
});

describe("rerankHits", () => {
  it("reorders by relevance_score and reports the cost", async () => {
    const fetch = (async () =>
      Response.json({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }], usage: { cost: 0.002 } })) as unknown as typeof globalThis.fetch;
    const out = await rerankHits([hit("a.ts"), hit("b.ts")], "q", { apiKey: "k", model: "m", fetch });
    expect(out.hits.map((h) => h.kind === "source" && h.path)).toEqual(["b.ts", "a.ts"]);
    expect(out.costUsd).toBe(0.002);
  });

  it("rejects a malformed response instead of returning garbage", async () => {
    const fetch = (async () => Response.json({ results: [{ idx: 0 }] })) as unknown as typeof globalThis.fetch;
    await expect(rerankHits([hit("a.ts")], "q", { apiKey: "k", model: "m", fetch })).rejects.toThrow();
  });
});
