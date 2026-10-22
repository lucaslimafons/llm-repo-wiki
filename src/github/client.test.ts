import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { create } from "tar";
import { afterAll, describe, expect, it } from "vitest";
import { COMPARE_FILE_CAP, createGitHubClient, GitHubError, type FetchLike } from "./client";
import { parseRepoFullName } from "./repo-name";

const SHA = "a".repeat(40);
const repo = { owner: "acme", name: "widgets" };

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url);
  };
  return { fetch, calls };
}

describe("parseRepoFullName", () => {
  it.each([
    ["vercel/next.js", { owner: "vercel", name: "next.js" }],
    ["  pmndrs/zustand ", { owner: "pmndrs", name: "zustand" }],
    ["https://github.com/pmndrs/zustand.git", { owner: "pmndrs", name: "zustand" }],
  ])("accepts %s", (input, ref) => {
    expect(parseRepoFullName(input)).toEqual(ref);
  });

  it.each(["", "zustand", "a/b/c", "-bad/repo", "owner/..", "owner/.", "own er/repo", "owner/re po", "../etc/passwd", "a".repeat(40) + "/x"])(
    "rejects %j",
    (input) => {
      expect(() => parseRepoFullName(input)).toThrow();
    },
  );
});

describe("GitHub client", () => {
  it("reads the default branch and sends the token only when configured", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ default_branch: "trunk", private: false }));
    expect(await createGitHubClient({ fetch }).getRepo(repo)).toEqual({ defaultBranch: "trunk", private: false });
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/widgets");
    expect(new Headers(calls[0].init?.headers).has("authorization")).toBe(false);

    await createGitHubClient({ fetch, token: "t0k" }).getRepo(repo);
    expect(new Headers(calls[1].init?.headers).get("authorization")).toBe("Bearer t0k");
  });

  it("gets the head sha with the sha media type", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(`${SHA}\n`));
    expect(await createGitHubClient({ fetch }).getHeadSha(repo, "main")).toBe(SHA);
    expect(calls[0].url).toBe("https://api.github.com/repos/acme/widgets/commits/main");
    expect(new Headers(calls[0].init?.headers).get("accept")).toBe("application/vnd.github.sha");
  });

  it("surfaces errors with the status and a rate-limit hint", async () => {
    const { fetch } = fakeFetch(() => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    const err = await createGitHubClient({ fetch }).getRepo(repo).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("rate limited");
  });

  it("maps compare statuses, keeping previous_filename for renames", async () => {
    const files = [
      { filename: "a.ts", status: "added" },
      { filename: "b.ts", status: "modified" },
      { filename: "c.ts", status: "removed" },
      { filename: "d2.ts", status: "renamed", previous_filename: "d.ts" },
      { filename: "e.ts", status: "copied" },
      { filename: "f.ts", status: "changed" },
    ];
    const { fetch, calls } = fakeFetch(() => Response.json({ files }));
    const result = await createGitHubClient({ fetch }).compare(repo, SHA, "b".repeat(40));
    expect(calls[0].url).toContain(`/compare/${SHA}...${"b".repeat(40)}`);
    expect(result).toEqual({
      tooLarge: false,
      files: [
        { status: "added", path: "a.ts" },
        { status: "modified", path: "b.ts" },
        { status: "removed", path: "c.ts" },
        { status: "renamed", path: "d2.ts", previousPath: "d.ts" },
        { status: "added", path: "e.ts" },
        { status: "modified", path: "f.ts" },
      ],
    });
  });

  it("reports a compare at the 300-file cap as too large", async () => {
    const files = Array.from({ length: COMPARE_FILE_CAP }, (_, i) => ({ filename: `f${i}.ts`, status: "modified" }));
    const { fetch } = fakeFetch(() => Response.json({ files }));
    expect(await createGitHubClient({ fetch }).compare(repo, SHA, SHA)).toEqual({ tooLarge: true });
  });

  it("treats an unreachable base (force-push) as too large", async () => {
    const { fetch } = fakeFetch(() => new Response("{}", { status: 404 }));
    expect(await createGitHubClient({ fetch }).compare(repo, SHA, SHA)).toEqual({ tooLarge: true });
  });

  it.each([
    ["a repo without default_branch", "getRepo", { private: false }],
    ["a compare file with an unknown status", "compare", { files: [{ filename: "a.ts", status: "exploded" }] }],
    ["a compare file with an empty filename", "compare", { files: [{ filename: "", status: "added" }] }],
  ])("rejects %s instead of indexing it", async (_name, method, body) => {
    const { fetch } = fakeFetch(() => Response.json(body));
    const client = createGitHubClient({ fetch });
    const call = method === "getRepo" ? client.getRepo(repo) : client.compare(repo, SHA, SHA);
    await expect(call).rejects.toThrow(/unexpected (repo|compare) response/);
  });

  describe("tarball", () => {
    let dir: string;
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("stream-extracts files, strips the top-level folder and honours accept()", async () => {
      dir = await mkdtemp(join(tmpdir(), "ingest-tar-"));
      const top = join(dir, "acme-widgets-abc1234");
      await mkdir(join(top, "src"), { recursive: true });
      await mkdir(join(top, "node_modules", "x"), { recursive: true });
      await writeFile(join(top, "README.md"), "# Widgets\n");
      await writeFile(join(top, "src", "index.ts"), "export const a = 1;\n");
      await writeFile(join(top, "node_modules", "x", "index.js"), "module.exports = 1;\n");
      const chunks: Buffer[] = [];
      for await (const c of create({ gzip: true, cwd: dir }, ["acme-widgets-abc1234"]) as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(c));
      }
      const tgz = Buffer.concat(chunks);

      const { fetch, calls } = fakeFetch(() => new Response(Readable.toWeb(Readable.from(tgz)) as ReadableStream));
      const files = await createGitHubClient({ fetch }).downloadTarball(repo, SHA, (p) => !p.startsWith("node_modules/"));
      expect(calls[0].url).toBe(`https://api.github.com/repos/acme/widgets/tarball/${SHA}`);
      expect(calls[0].init?.redirect).toBe("follow");
      expect([...files.keys()].sort()).toEqual(["README.md", "src/index.ts"]);
      expect(files.get("src/index.ts")?.toString()).toBe("export const a = 1;\n");
    });

    it("refuses a non-sha ref", async () => {
      const { fetch } = fakeFetch(() => new Response(""));
      await expect(createGitHubClient({ fetch }).downloadTarball(repo, "main")).rejects.toThrow("invalid sha");
    });
  });
});
