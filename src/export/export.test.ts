import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Author } from "@/core/contracts";
import { repos } from "@/db/schema";
import { resetDb, testDb } from "@/test/db";
import { createWikiStore } from "@/wiki/store";
import { buildExport, exportWiki, loadExportPages } from "./export";

const human: Author = { kind: "human" };
const store = createWikiStore(testDb(), { enqueueIndexPage: async () => {} });

async function create(title: string, parentId: string | null, bodyMd: string, mode: "apply" | "propose" = "apply") {
  return (await store.createPage({ parentId, title, bodyMd, reason: "t", citations: [], author: human, mode })).pageId;
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(e.isDirectory() ? `${rel}/` : rel);
    if (e.isDirectory()) out.push(...(await listFiles(dir, rel)));
  }
  return out;
}

beforeEach(async () => {
  await resetDb();
  await testDb().insert(repos).values({ owner: "acme", name: "api" });
});

describe("markdown export", () => {
  it("writes leaf pages as slug.md, parents as slug/README.md, and a root index", async () => {
    const overview = await create("Overview", null, "Start here.");
    const arch = await create("Architecture", null, "See [Overview](wiki:" + overview + ").");
    const ingest = await create("Ingest-pipeline v2", arch, "");
    await store.updatePage({
      pageId: ingest,
      bodyMd: [
        "Back to [arch](wiki:" + arch + ").",
        "Reads [index.ts#L3-L9](source:acme/api/src/index.ts#L3-L9@abc1234).",
        "Gone: [old](wiki:00000000-0000-4000-8000-000000000000).",
        "```md",
        "[literal](wiki:" + arch + ")",
        "```",
      ].join("\r\n"),
      reason: "t",
      citations: [],
      author: human,
      mode: "apply",
    });
    await create("Draft", arch, "pending", "propose");
    await store.movePage({ pageId: overview, newParentId: null, index: 0, author: human });

    const files = buildExport(await loadExportPages(testDb()));
    expect(Object.fromEntries(files)).toEqual({
      "README.md": [
        "# Wiki",
        "",
        "- [Overview](./overview.md)",
        "- [Architecture](./architecture/README.md)",
        "  - [Ingest-pipeline v2](./architecture/ingest-pipeline-v2.md)",
        "",
      ].join("\n"),
      "overview.md": "# Overview\n\nStart here.\n",
      "architecture/README.md": "# Architecture\n\nSee [Overview](../overview.md).\n",
      "architecture/ingest-pipeline-v2.md": [
        "# Ingest-pipeline v2",
        "",
        "Back to [arch](./README.md).",
        "Reads [index.ts#L3-L9](https://github.com/acme/api/blob/abc1234/src/index.ts#L3-L9).",
        "Gone: old.",
        "```md",
        "[literal](wiki:" + arch + ")",
        "```",
        "",
      ].join("\n"),
    });
  });

  it("keeps a body's own title, and never lets a page take the folder's README.md", async () => {
    const parent = await create("Guides", null, "# Guides, the long version\n\nIntro.");
    await create("README", parent, "x");
    const files = buildExport(await loadExportPages(testDb()));
    expect(files.get("guides/README.md")).toBe("# Guides, the long version\n\nIntro.\n");
    expect(files.get("guides/readme-2.md")).toBe("# README\n\nx\n");
  });

  it("is deterministic on disk and refuses to overwrite without --force", async () => {
    const a = await create("A", null, "a");
    await create("B c", a, "b");
    const [one, two] = [await mkdtemp(join(tmpdir(), "wiki-")), await mkdtemp(join(tmpdir(), "wiki-"))];
    await exportWiki(testDb(), one);
    await exportWiki(testDb(), two);
    const names = await listFiles(one);
    expect([...names].sort()).toEqual(["README.md", "a/", "a/README.md", "a/b-c.md"]);
    expect(await listFiles(two)).toEqual(names);
    for (const n of names.filter((x) => !x.endsWith("/"))) {
      expect(await readFile(join(two, n))).toEqual(await readFile(join(one, n)));
    }
    await expect(exportWiki(testDb(), one)).rejects.toThrow(/--force/);
    await expect(exportWiki(testDb(), one, { force: true })).resolves.toEqual({ files: 3 });
  });
});
