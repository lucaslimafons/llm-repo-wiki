import { beforeEach, describe, expect, it } from "vitest";
import { repos } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { formatProjectContext, getProjectContext, saveProjectContext } from "./context";
import { MAX_CONTEXT_CHARS } from "./schema";

const db = testDb();
const UNKNOWN = "11111111-1111-4111-8111-111111111111";

describe("project context", () => {
  beforeEach(resetDb);

  it("is empty until saved, and then round-trips with each repo's role", async () => {
    const [mobile, site] = await db.insert(repos).values([{ owner: "acme", name: "mobile" }, { owner: "acme", name: "site" }]).returning();
    expect(await getProjectContext(db)).toEqual({
      context: "",
      repos: [
        { id: mobile.id, fullName: "acme/mobile", role: null },
        { id: site.id, fullName: "acme/site", role: null },
      ],
    });

    const saved = await saveProjectContext(db, {
      context: "  One recipe product.  ",
      roles: [
        { repoId: mobile.id, role: "mobile app" },
        { repoId: site.id, role: "" },
        { repoId: UNKNOWN, role: "ignored" },
      ],
    });
    expect(saved).toEqual({ ok: true, data: undefined });
    expect(await getProjectContext(db)).toEqual({
      context: "One recipe product.",
      repos: [
        { id: mobile.id, fullName: "acme/mobile", role: "mobile app" },
        { id: site.id, fullName: "acme/site", role: null },
      ],
    });

    await saveProjectContext(db, { context: "Edited.", roles: [] });
    expect((await getProjectContext(db)).context).toBe("Edited.");
  });

  it("refuses an over-long brief or a malformed repo id without writing", async () => {
    expect((await saveProjectContext(db, { context: "x".repeat(MAX_CONTEXT_CHARS + 1), roles: [] })).ok).toBe(false);
    expect((await saveProjectContext(db, { context: "ok", roles: [{ repoId: "not-a-uuid", role: "x" }] })).ok).toBe(false);
    expect((await getProjectContext(db)).context).toBe("");
  });
});

describe("formatProjectContext", () => {
  it("is null when the owner wrote nothing", () => {
    expect(formatProjectContext({ context: "", repos: [{ id: "a", fullName: "acme/mobile", role: null }] })).toBeNull();
  });

  it("lists every repo with its role under the brief", () => {
    const text = formatProjectContext({
      context: "One recipe product.",
      repos: [
        { id: "a", fullName: "acme/mobile", role: "mobile app" },
        { id: "b", fullName: "acme/site", role: null },
      ],
    })!;
    expect(text).toContain("One recipe product.");
    expect(text).toContain("- acme/mobile: mobile app\n- acme/site");
  });
});
