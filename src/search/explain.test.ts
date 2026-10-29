import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { explainAnswer } from "@/agent/explain-answer";
import { usage } from "@/agent/testing/mock-model";
import { agentRuns, chunks, repos } from "@/db/schema";
import { fakeEmbedder } from "@/ingest/test-helpers";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { searchKnowledge } from ".";
import { explainSearch } from "./explain";

const db = testDb();
const DIMS = 1536;
const QUERY = "token refresh";
const SHA = "c".repeat(40);
let wikiId: string;

function axis(a: number, weight = 0, b = 1): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[a] = 1;
  v[b] += weight;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

async function chunk(repoId: string, path: string, content: string, embedding: number[]) {
  const [c] = await db
    .insert(chunks)
    .values({ repoId, path, kind: "code", startLine: 1, endLine: 1, content, embeddedText: content, contentHash: path, commitSha: SHA, embeddingModel: "fake-embedding", embedding })
    .returning({ id: chunks.id });
  return c.id;
}

describe("explainSearch", () => {
  beforeEach(async () => {
    await resetDb();
    wikiId = await createTestWiki();
  });
  const embedder = fakeEmbedder({ [QUERY]: axis(0) });

  async function fixture() {
    const [r] = await db.insert(repos).values({ wikiId, owner: "acme", name: "auth" }).returning({ id: repos.id });
    const vectorOnly = await chunk(r.id, "src/session.ts", "export function renew() {}", axis(0));
    const both = await chunk(r.id, "src/auth.ts", "export function tokenRefresh() { /* token refresh */ }", axis(0, 0.6));
    await chunk(r.id, "docs/notes.ts", "// unrelated", axis(2));
    return { vectorOnly, both };
  }

  it("shows each list's ranks and a fused order identical to chat search", async () => {
    const { vectorOnly, both } = await fixture();
    const x = await explainSearch(wikiId, { query: QUERY }, { db, embedder });

    expect(x.tsquery).toBe("'token' | 'refresh'");
    expect(x.embedding).toMatchObject({ model: "fake-embedding", dims: DIMS });
    expect(x.fts.map((i) => i.key)).toEqual([`source:${both}`]);
    expect(x.vector.slice(0, 2).map((i) => i.key)).toEqual([`source:${vectorOnly}`, `source:${both}`]);
    expect(x.fused[0]).toMatchObject({ key: `source:${both}`, ftsRank: 1, vecRank: 2, fusedRank: 1 });
    expect(x.fused[0].fusedScore).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(x.vector[0].vecSimilarity).toBeCloseTo(1, 6);

    const chat = await searchKnowledge({ wikiId, query: QUERY, scope: "all" }, { db, embedder });
    expect(x.fused.map((i) => (i.hit.kind === "source" ? i.hit.chunkId : null))).toEqual(chat.map((h) => (h.kind === "source" ? h.chunkId : null)));
  });

  it("refuses rerank before any call while zero data retention is on, and says so", async () => {
    await fixture();
    const x = await explainSearch(wikiId, { query: QUERY }, { db, embedder });
    expect(x.rerankAvailable).toBe(false);
    const calls = embedder.calls;
    await expect(explainSearch(wikiId, { query: QUERY, rerank: true }, { db, embedder })).rejects.toThrow("OPENROUTER_ZDR");
    expect(embedder.calls).toBe(calls);
  });

  it("grounds the answer: a citation to a chunk it was given survives, an invented one is stripped", async () => {
    const { both } = await fixture();
    const good = `source:acme/auth/src/auth.ts#L1-L1@${SHA}`;
    const invented = `source:acme/auth/src/secret.ts#L1-L9@${SHA}`;
    const model = new MockLanguageModelV4({
      modelId: "mock-chat",
      doGenerate: async () => ({
        content: [{ type: "text", text: `It refreshes [here](${good}) and [there](${invented}).` }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(200, 40),
        providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
        warnings: [],
      }),
    });

    const a = await explainAnswer({ query: QUERY, keys: [`source:${both}`] }, { db, wikiId, model });
    expect(a.kept).toEqual([{ repo: "acme/auth", path: "src/auth.ts", commitSha: SHA, startLine: 1, endLine: 1 }]);
    expect(a.stripped).toEqual([invented]);
    expect(a.answerMd).toContain(`[here](${good})`);
    expect(a.answerMd).toContain("and there.");
    expect(a).toMatchObject({ tokens: 240, costUsd: 0.001 });
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.kind, "chat"));
    expect(run.status).toBe("succeeded");
  });

  it("refuses keys that are not chunk ids", async () => {
    await expect(explainAnswer({ query: QUERY, keys: ["source:../../etc"] }, { db, wikiId, model: new MockLanguageModelV4() })).rejects.toThrow();
  });
});
