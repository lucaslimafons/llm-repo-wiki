import { eq } from "drizzle-orm";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import type { SearchHit } from "@/core/contracts";
import { agentRuns, projectSettings, repos, wikiLog } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { collectCitations, groundDraft, runAuthorJob, type AuthorDeps } from "./author";
import { createFakeStore } from "./testing/fake-store";
import { usage } from "./testing/mock-model";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const cite = (path: string) => `source:acme/api/${path}#L1-L20@${SHA}`;

const hit: SearchHit = {
  kind: "source",
  chunkId: "c",
  repo: "acme/api",
  path: "src/server.ts",
  startLine: 1,
  endLine: 20,
  commitSha: SHA,
  symbol: null,
  content: "export function serve() {}",
  score: 1,
};

/**
 * Plays an author model: it answers every request with JSON straight away (the job retrieves, so no
 * tool calls), the outline when the prompt asks for one, otherwise a page draft from `drafts`.
 */
function authorModel(outline: string[], drafts: (title: string) => { bodyMd: string; citations: string[] }) {
  return new MockLanguageModelV4({
    modelId: "mock-author",
    doGenerate: async ({ prompt }) => {
      const firstUser = JSON.stringify(prompt.find((m) => m.role === "user"));
      const base = { finishReason: { unified: "stop" as const, raw: undefined }, usage: usage(100, 50), providerMetadata: { openrouter: { usage: { cost: 0.002 } } }, warnings: [] };
      if (firstUser.includes("OUTLINE")) {
        const pages = outline.map((path) => ({ path, purpose: `About ${path}`, queries: ["q"] }));
        return { ...base, content: [{ type: "text" as const, text: JSON.stringify({ pages }) }] };
      }
      const title = /wiki page \\"([^"\\]+)\\"/.exec(firstUser)?.[1] ?? "?";
      return { ...base, content: [{ type: "text" as const, text: JSON.stringify(drafts(title)) }] };
    },
  });
}

let repoId: string;
const searches: unknown[] = [];

function deps(model: MockLanguageModelV4, fake = createFakeStore(), extra: Partial<AuthorDeps> = {}) {
  const d: AuthorDeps = {
    db: testDb(),
    store: fake.store,
    search: async (input) => (searches.push(input), [hit]),
    model,
    loadSchema: async () => "# schema",
    ...extra,
  };
  return { d, fake };
}

const goodDraft = (title: string) => ({
  bodyMd: `# ${title}\n\nServes HTTP [src/server.ts#L1-L20](${cite("src/server.ts")}).`,
  citations: [cite("src/server.ts")],
});

beforeEach(async () => {
  await resetDb();
  searches.length = 0;
  const [repo] = await testDb().insert(repos).values({ owner: "acme", name: "api" }).returning();
  repoId = repo.id;
});

describe("author-wiki: first run", () => {
  const outline = ["Overview", "Architecture", "Architecture/Server", "Glossary", "../evil", "Guides"];
  const drafts = (title: string) => (title === "Glossary" ? { bodyMd: "# Glossary\n\nUncited claims.", citations: [] } : goodDraft(title));

  it("proposes cited pages under the page budget and drops uncited or invalid ones", async () => {
    const model = authorModel(outline, drafts);
    const { d, fake } = deps(model, undefined, { maxPages: 4 });
    const result = await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });

    expect(result.mode).toBe("initial");
    expect(result.proposed).toEqual(["Overview", "Architecture", "Architecture/Server"]);
    expect(result.dropped).toEqual([
      { path: "Glossary", reason: "the draft cited no retrieved source" },
      { path: "../evil", reason: "invalid path" },
      { path: "Guides", reason: "page budget of 4 reached" },
    ]);

    const writes = fake.writes();
    expect(writes.map((w) => w.method)).toEqual(["createPage", "createPage", "createPage"]);
    const [run] = await testDb().select().from(agentRuns);
    for (const w of writes) {
      expect(w.input).toMatchObject({ mode: "propose", author: { kind: "agent", agentRunId: run.id } });
      expect((w.input as { citations: unknown[] }).citations.length).toBeGreaterThan(0);
    }
    // The child landed under its (proposed) parent.
    const server = await fake.store.getPage({ path: "Architecture/Server" });
    expect(server?.parentId).toBe((await fake.store.getPage({ path: "Architecture" }))?.id);
    // Evidence comes from every repo's sources: the repos are parts of one project.
    expect(searches.every((s) => (s as { scope: string }).scope === "source" && !("repo" in (s as object)))).toBe(true);
  });

  it("records the run's tokens and cost from provider metadata, and logs to wiki_log", async () => {
    const model = authorModel(outline, drafts);
    const { d } = deps(model, undefined, { maxPages: 4 });
    await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });

    const calls = model.doGenerateCalls.length;
    const [run] = await testDb().select().from(agentRuns);
    expect(run).toMatchObject({ kind: "author", status: "succeeded", inputTokens: 100 * calls, outputTokens: 50 * calls });
    expect(Number(run.costUsd)).toBeCloseTo(0.002 * calls, 6);

    const logs = await testDb().select().from(wikiLog).where(eq(wikiLog.repoId, repoId));
    const actions = logs.map((l) => l.action);
    expect(actions.filter((a) => a === "author.page_proposed")).toHaveLength(3);
    expect(actions).toContain("author.started");
    expect(actions).toContain("author.finished");
    expect(logs.find((l) => l.action === "author.page_dropped" && l.details?.path === "Glossary")?.details?.reason).toBe("the draft cited no retrieved source");
  });

  it("a retried job doesn't duplicate proposals", async () => {
    const fake = createFakeStore();
    await runAuthorJob(deps(authorModel(outline, drafts), fake, { maxPages: 4 }).d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    const before = fake.writes().length;
    const again = await runAuthorJob(deps(authorModel(outline, drafts), fake, { maxPages: 4 }).d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    expect(fake.writes()).toHaveLength(before);
    expect(again.skipped.map((s) => s.path)).toEqual(["Overview", "Architecture", "Architecture/Server"]);
    // Logged too, so the Jobs page can account for every planned page.
    const skippedLogs = await testDb().select().from(wikiLog).where(eq(wikiLog.action, "author.page_skipped"));
    expect(skippedLogs.map((l) => l.details?.reason)).toEqual(["exists", "exists", "exists"]);
  });

  it("stops proposing once the token budget is spent", async () => {
    const { d, fake } = deps(authorModel(outline, drafts), undefined, { tokenBudget: 400 });
    const result = await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    expect(result.status).toBe("budget_exceeded");
    expect(fake.writes().length).toBeLessThan(3);
    const [run] = await testDb().select().from(agentRuns);
    expect(run.status).toBe("budget_exceeded");
  });
});

describe("author-wiki: incremental run", () => {
  it("re-proposes only pages citing changed files (or stale), never deletes or moves", async () => {
    const fake = createFakeStore();
    const c = (path: string, repo = "acme/api") => ({ repo, path, commitSha: SHA, startLine: 1, endLine: 20 });
    fake.seed("Architecture/Server", "# Server", [c("src/server.ts")]);
    fake.seed("Guides/Setup", "# Setup", [c("README.md")]);
    fake.seed("Overview", "# Overview", [c("src/db.ts")], { stale: true });
    fake.seed("Web", "# Web", [c("src/app.ts", "acme/web")], { stale: true });

    const model = authorModel([], goodDraft);
    const payload = { repoId, fromSha: "1111111", toSha: SHA, changedPaths: ["src/server.ts"] };
    const result = await runAuthorJob(deps(model, fake).d, payload);

    expect(result.mode).toBe("incremental");
    expect(result.proposed.sort()).toEqual(["Architecture/Server", "Overview"]);
    const writes = fake.writes();
    expect(writes.every((w) => w.method === "updatePage")).toBe(true);
    expect(writes.every((w) => (w.input as { mode: string }).mode === "propose")).toBe(true);

    const rerun = await runAuthorJob(deps(authorModel([], goodDraft), fake).d, payload);
    expect(rerun.proposed).toEqual([]);
    expect(rerun.skipped.map((s) => s.reason)).toEqual(["already proposed for this sha", "already proposed for this sha"]);
    expect(fake.writes()).toHaveLength(writes.length);
  });
});

describe("author-wiki: uncovered changes", () => {
  it("extends an existing page or proposes a new one for changed files no page cites", async () => {
    const fake = createFakeStore();
    const c = (path: string) => ({ repo: "acme/api", path, commitSha: SHA, startLine: 1, endLine: 20 });
    fake.seed("Architecture", "# Architecture", [c("src/index.ts")]);
    fake.seed("Architecture/Server", "# Server", [c("src/server.ts")]);

    const model = authorModel(["Architecture/Server", "Architecture/Billing"], goodDraft);
    const payload = { repoId, fromSha: "1111111", toSha: SHA, changedPaths: ["src/billing.ts"] };
    const result = await runAuthorJob(deps(model, fake).d, payload);

    expect(result.proposed.sort()).toEqual(["Architecture/Billing", "Architecture/Server"]);
    const writes = fake.writes();
    expect(writes.map((w) => w.method).sort()).toEqual(["createPage", "updatePage"]);
    expect(writes.every((w) => (w.input as { mode: string }).mode === "propose")).toBe(true);
  });

  it("makes no planning call when every changed file is already cited", async () => {
    const fake = createFakeStore();
    fake.seed("Architecture/Server", "# Server", [{ repo: "acme/api", path: "src/server.ts", commitSha: SHA, startLine: 1, endLine: 20 }]);
    const model = authorModel(["Should/Not/Appear"], goodDraft);
    const result = await runAuthorJob(deps(model, fake).d, { repoId, fromSha: "1111111", toSha: SHA, changedPaths: ["src/server.ts"] });
    expect(result.proposed).toEqual(["Architecture/Server"]);
  });
});

describe("author-wiki: grounding", () => {
  it("strips citations to anything the job did not retrieve, and drops a page left uncited", async () => {
    const invented = (title: string) => ({
      bodyMd: `# ${title}\n\nReal [a](${cite("src/server.ts")}). Made up [b](source:acme/api/src/secret.ts#L1-L5@${SHA}).`,
      citations: [cite("src/server.ts"), `source:acme/api/src/secret.ts#L1-L5@${SHA}`],
    });
    const { d, fake } = deps(authorModel(["Overview"], invented));
    await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    const [write] = fake.writes();
    const input = write.input as { bodyMd: string; citations: { path: string }[] };
    expect(input.citations.map((c) => c.path)).toEqual(["src/server.ts"]);
    expect(input.bodyMd).toContain("Made up b.");
    expect(input.bodyMd).not.toContain("src/secret.ts");

    const onlyInvented = () => ({ bodyMd: `x [b](source:acme/api/src/secret.ts#L1-L5@${SHA})`, citations: [] });
    const second = deps(authorModel(["Glossary"], onlyInvented));
    const result = await runAuthorJob(second.d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    expect(result.dropped).toEqual([{ path: "Glossary", reason: "the draft cited no retrieved source" }]);
  });

  it("rejects a cited line range outside the retrieved chunk", () => {
    const out = groundDraft({ bodyMd: `x [a](source:acme/api/src/server.ts#L15-L40@${SHA})`, citations: [] }, [hit]);
    expect(out.citations).toEqual([]);
    expect(out.rejected).toBe(1);
  });

  it("fails loudly on an empty outline instead of succeeding with no pages", async () => {
    const { d } = deps(authorModel([], goodDraft));
    await expect(runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] })).rejects.toThrow("outline came back empty");
  });
});

describe("author-wiki: resilience", () => {
  it("drops a page whose draft the model fumbles and keeps writing the rest", async () => {
    const flaky = (title: string) => (title === "Architecture" ? { bodyMd: 42 as unknown as string, citations: [] } : goodDraft(title));
    const { d } = deps(authorModel(["Overview", "Architecture", "Glossary"], flaky));
    const result = await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });
    expect(result.proposed).toEqual(["Overview", "Glossary"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]).toMatchObject({ path: "Architecture" });
    expect(result.dropped[0].reason).toMatch(/^the model failed to write it/);
  });

  it("stops at the first credit or auth error instead of burning through every page", async () => {
    const outOfCredits = new APICallError({ message: "Insufficient credits", url: "u", requestBodyValues: {}, statusCode: 402 });
    let drafts = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const base = { finishReason: { unified: "stop" as const, raw: undefined }, usage: usage(10, 10), warnings: [] };
        if (JSON.stringify(prompt).includes("OUTLINE")) {
          return { ...base, content: [{ type: "text" as const, text: JSON.stringify({ pages: ["A", "B", "C"].map((path) => ({ path, purpose: path, queries: [] })) }) }] };
        }
        drafts++;
        throw outOfCredits;
      },
    });
    await expect(runAuthorJob(deps(model).d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] })).rejects.toThrow("Insufficient credits");
    expect(drafts).toBe(1);
  });

  it("fails the run when every draft fails, so pg-boss retries it", async () => {
    const broken = () => ({ bodyMd: 42 as unknown as string, citations: [] });
    const { d } = deps(authorModel(["Overview", "Glossary"], broken));
    await expect(runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] })).rejects.toThrow("every page draft failed (2)");
  });
});

describe("collectCitations", () => {
  it("merges body links with the returned list, dedupes across repos, and skips garbage", () => {
    const body = `a [x](${cite("a.ts")}) b [y](${cite("a.ts")}) c [z](source:other/repo/b.ts#L1@${SHA})`;
    expect(collectCitations(body, [cite("b.ts"), "garbage"]).map((c) => `${c.repo}/${c.path}`)).toEqual([
      "acme/api/b.ts",
      "acme/api/a.ts",
      "other/repo/b.ts",
    ]);
  });
});

describe("author-wiki: one project, several repos", () => {
  const webCite = { repo: "acme/web", path: "app/page.tsx", commitSha: SHA, startLine: 1, endLine: 10 };
  const webHref = `source:acme/web/app/page.tsx#L1-L10@${SHA}`;

  it("extends a page another repo wrote, keeping that repo's citations", async () => {
    const extended = (title: string) => ({
      bodyMd: `# ${title}\n\nThe site [p](${webHref}). The API [s](${cite("src/server.ts")}).`,
      citations: [webHref, cite("src/server.ts")],
    });
    const { d, fake } = deps(authorModel(["Overview"], extended));
    fake.seed("Overview", `# Overview\n\nThe site [p](${webHref}).`, [webCite]);

    const result = await runAuthorJob(d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });

    expect(result.proposed).toEqual(["Overview"]);
    const [write] = fake.writes();
    expect(write.method).toBe("updatePage");
    const input = write.input as { bodyMd: string; citations: { repo: string }[]; mode: string };
    expect(input.mode).toBe("propose");
    expect(input.citations.map((c) => c.repo).sort()).toEqual(["acme/api", "acme/web"]);
    expect(input.bodyMd).toContain(webHref);
  });

  it("still strips a citation into another repo that was neither retrieved nor already on the page", () => {
    const out = groundDraft({ bodyMd: `x [p](${webHref})`, citations: [webHref] }, [hit]);
    expect(out.citations).toEqual([]);
    expect(out.bodyMd).toBe("x p");
  });

  it("puts the owner's project context and the other repos into the outline", async () => {
    const db = testDb();
    const [web] = await db.insert(repos).values({ owner: "acme", name: "web", role: "marketing website" }).returning();
    await db.insert(projectSettings).values({ id: 1, context: "Acme is one product." });
    const prompts: string[] = [];
    const base = authorModel(["Overview"], goodDraft);
    const model = new MockLanguageModelV4({
      modelId: "mock-author",
      doGenerate: async (opts) => (prompts.push(JSON.stringify(opts.prompt)), base.doGenerate(opts)),
    });

    await runAuthorJob(deps(model).d, { repoId, fromSha: null, toSha: SHA, changedPaths: [] });

    const outline = prompts.find((p) => p.includes("OUTLINE"))!;
    expect(outline).toContain("Acme is one product.");
    expect(outline).toContain(`acme/web: ${web.role}`);
    expect(outline).toContain("Other repositories of this project are already in the wiki (acme/web)");
  });
});
