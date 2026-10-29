import { beforeEach, describe, expect, it } from "vitest";
import { pages, repos } from "@/db/schema";
import { createTestWiki, resetDb, testDb } from "@/test/db";
import { createWikiStore } from "@/wiki/store";
import { slugify } from "./schema";
import { createWiki, deleteWiki, listWikis, resolveWiki } from "./wikis";

const db = testDb();
const human = { kind: "human" } as const;

beforeEach(resetDb);

describe("wikis", () => {
  it("slugs the name and suffixes a taken slug", async () => {
    expect(slugify("Café Shop — Mobile!")).toBe("cafe-shop-mobile");
    const first = await createWiki(db, { name: "Shop" });
    const second = await createWiki(db, { name: "shop" });
    expect(first.ok && first.data.slug).toBe("shop");
    expect(second.ok && second.data.slug).toBe("shop-2");
    expect((await createWiki(db, { name: "   " })).ok).toBe(false);
  });

  it("deletes a wiki with its nested pages and repos, and leaves other wikis alone", async () => {
    const doomed = await createTestWiki("doomed");
    const kept = await createTestWiki("kept");
    await db.insert(repos).values([{ wikiId: doomed, owner: "acme", name: "a" }, { wikiId: kept, owner: "acme", name: "b" }]);
    const store = createWikiStore(db, { wikiId: doomed, enqueueIndexPage: async () => {} });
    const page = (title: string, parentId: string | null) =>
      store.createPage({ parentId, title, bodyMd: "x", reason: "x", citations: [], author: human, mode: "apply" });
    const root = await page("Root", null);
    await page("Child", (await page("Mid", root.pageId)).pageId);

    expect(await deleteWiki(db, doomed)).toBe(true);
    expect((await listWikis(db)).map((w) => [w.slug, w.repoCount])).toEqual([["kept", 1]]);
    expect(await db.select().from(pages)).toEqual([]);
  });

  it("resolves the only wiki without a slug, and asks for one when there are several", async () => {
    await expect(resolveWiki(db, undefined)).rejects.toThrow("No wiki exists yet");
    await createTestWiki("one");
    expect((await resolveWiki(db, undefined)).slug).toBe("one");
    await createTestWiki("two");
    await expect(resolveWiki(db, undefined)).rejects.toThrow("Wikis: one, two");
    expect((await resolveWiki(db, "two")).slug).toBe("two");
    await expect(resolveWiki(db, "nope")).rejects.toThrow('No wiki "nope"');
  });
});
