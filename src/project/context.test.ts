import { beforeEach, describe, expect, it } from "vitest";
import { repos } from "@/db/schema";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { formatProjectContext, getProjectContext, saveProjectContext } from "./context";
import { MAX_CONTEXT_CHARS } from "./schema";

const db = testDb();
const UNKNOWN = "11111111-1111-4111-8111-111111111111";
let wikiId: string;

describe("project context", () => {
  beforeEach(async () => {
    await resetDb();
    wikiId = await createTestWiki();
  });

  it("is empty until saved, and then round-trips with each repo's role", async () => {
    const [mobile, site] = await db.insert(repos).values([{ wikiId, owner: "acme", name: "mobile" }, { wikiId, owner: "acme", name: "site" }]).returning();
    expect(await getProjectContext(db, wikiId)).toEqual({
      name: "main",
      context: "",
      layout: "topic",
      repos: [
        { id: mobile.id, fullName: "acme/mobile", role: null },
        { id: site.id, fullName: "acme/site", role: null },
      ],
    });

    const saved = await saveProjectContext(db, wikiId, { name: "main",
      context: "  One recipe product.  ",
      layout: "repo",
      roles: [
        { repoId: mobile.id, role: "mobile app" },
        { repoId: site.id, role: "" },
        { repoId: UNKNOWN, role: "ignored" },
      ],
    });
    expect(saved).toEqual({ ok: true, data: undefined });
    expect(await getProjectContext(db, wikiId)).toEqual({
      name: "main",
      context: "One recipe product.",
      layout: "repo",
      repos: [
        { id: mobile.id, fullName: "acme/mobile", role: "mobile app" },
        { id: site.id, fullName: "acme/site", role: null },
      ],
    });

    await saveProjectContext(db, wikiId, { name: "main", context: "Edited.", layout: "topic", roles: [] });
    expect((await getProjectContext(db, wikiId)).context).toBe("Edited.");
  });

  it("refuses an over-long brief or a malformed repo id without writing", async () => {
    expect((await saveProjectContext(db, wikiId, { name: "main", context: "x".repeat(MAX_CONTEXT_CHARS + 1), layout: "topic", roles: [] })).ok).toBe(false);
    expect((await saveProjectContext(db, wikiId, { name: "main", context: "ok", layout: "topic", roles: [{ repoId: "not-a-uuid", role: "x" }] })).ok).toBe(false);
    expect((await saveProjectContext(db, wikiId, { name: "main", context: "ok", layout: "per-team", roles: [] })).ok).toBe(false);
    expect((await getProjectContext(db, wikiId)).context).toBe("");
  });
});

describe("formatProjectContext", () => {
  it("is null for a lone repo the owner said nothing about", () => {
    expect(formatProjectContext({ name: "main", context: "", layout: "topic", repos: [{ id: "a", fullName: "acme/mobile", role: null }] })).toBeNull();
  });

  it("always asks for a project-level Overview and Architecture, then the chosen layout", () => {
    const repos = [
      { id: "a", fullName: "acme/mobile", role: null },
      { id: "b", fullName: "acme/site", role: null },
    ];
    const topic = formatProjectContext({ name: "main", context: "", layout: "topic", repos })!;
    const byRepo = formatProjectContext({ name: "main", context: "", layout: "repo", repos })!;
    for (const text of [topic, byRepo]) expect(text).toContain("describe the WHOLE project");
    expect(topic).toContain("Layout: BY TOPIC");
    expect(byRepo).toContain("Layout: BY REPOSITORY");
    expect(byRepo).toContain("named exactly after it (`mobile`, `site`)");
  });

  it("lists every repo with its role under the brief", () => {
    const text = formatProjectContext({
      name: "main",
      context: "One recipe product.",
      layout: "topic",
      repos: [
        { id: "a", fullName: "acme/mobile", role: "mobile app" },
        { id: "b", fullName: "acme/site", role: null },
      ],
    })!;
    expect(text).toContain("One recipe product.");
    expect(text).toContain("- acme/mobile: mobile app\n- acme/site");
  });
});
