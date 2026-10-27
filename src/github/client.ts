import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Parser, type ReadEntry } from "tar";
import { z } from "zod";
import type { RepoRef } from "./repo-name";

const repoPathString = z.string().min(1).max(1024);

const repoResponseSchema = z.object({
  default_branch: z.string().min(1),
  private: z.boolean().default(false),
});

const compareResponseSchema = z.object({
  files: z
    .array(
      z.object({
        filename: repoPathString,
        status: z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
        previous_filename: repoPathString.optional(),
      }),
    )
    .default([]),
});

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type CompareFile = {
  status: "added" | "modified" | "removed" | "renamed";
  path: string;
  /** Set for renames only. */
  previousPath?: string;
};

/** `tooLarge`: the compare result may be truncated, so the caller must do a full reconcile. */
export type CompareResult = { tooLarge: true } | { tooLarge: false; files: CompareFile[] };

export type GitHubClient = {
  getRepo(repo: RepoRef): Promise<{ defaultBranch: string; private: boolean }>;
  getHeadSha(repo: RepoRef, branch: string): Promise<string>;
  /** Every file at `sha`, top-level folder stripped. `accept` runs before a body is buffered. */
  downloadTarball(
    repo: RepoRef,
    sha: string,
    accept?: (path: string, size: number) => boolean,
  ): Promise<Map<string, Buffer>>;
  compare(repo: RepoRef, base: string, head: string): Promise<CompareResult>;
};

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** 🔴 The compare API silently truncates `files` at 300. */
export const COMPARE_FILE_CAP = 300;

const SHA_RE = /^[0-9a-f]{40}$/;

export function createGitHubClient(opts: { token?: string; fetch?: FetchLike; baseUrl?: string } = {}): GitHubClient {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = opts.baseUrl ?? "https://api.github.com";

  async function call(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "llm-repo-wiki",
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await doFetch(`${base}${path}`, { headers, redirect: "follow" });
    if (!res.ok) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const hint = remaining === "0" ? " (rate limited: set GITHUB_TOKEN)" : "";
      throw new GitHubError(`GitHub ${res.status} for ${path}${hint}`, res.status);
    }
    return res;
  }

  /** GitHub's JSON is external input: parse it, so a shape change fails loudly instead of indexing garbage. */
  async function parse<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new GitHubError(`GitHub: unexpected ${what} response`, 502);
    return parsed.data;
  }

  const repoPath = (r: RepoRef) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

  return {
    async getRepo(repo) {
      const json = await parse(await call(repoPath(repo)), repoResponseSchema, "repo");
      return { defaultBranch: json.default_branch, private: json.private };
    },

    async getHeadSha(repo, branch) {
      // The sha media type returns the bare 40-char sha: no JSON, no commit payload.
      const res = await call(`${repoPath(repo)}/commits/${encodeURIComponent(branch)}`, "application/vnd.github.sha");
      const sha = (await res.text()).trim();
      if (!SHA_RE.test(sha)) throw new GitHubError(`GitHub: unexpected head sha for ${branch}`, 502);
      return sha;
    },

    async downloadTarball(repo, sha, accept = () => true) {
      if (!SHA_RE.test(sha)) throw new Error(`invalid sha: ${sha}`);
      const res = await call(`${repoPath(repo)}/tarball/${sha}`);
      if (!res.body) throw new GitHubError("GitHub: empty tarball body", 502);
      return extractTarball(Readable.fromWeb(res.body as never), accept);
    },

    async compare(repo, baseSha, headSha) {
      let res: Response;
      try {
        res = await call(`${repoPath(repo)}/compare/${baseSha}...${headSha}?per_page=1`);
      } catch (err) {
        // A force-push can make the old base unreachable: reconcile from scratch instead.
        if (err instanceof GitHubError && (err.status === 404 || err.status === 422)) return { tooLarge: true };
        throw err;
      }
      const raw = (await parse(res, compareResponseSchema, "compare")).files;
      if (raw.length >= COMPARE_FILE_CAP) return { tooLarge: true };
      const files: CompareFile[] = [];
      for (const f of raw) {
        if (f.status === "unchanged") continue;
        if (f.status === "renamed" && f.previous_filename) {
          files.push({ status: "renamed", path: f.filename, previousPath: f.previous_filename });
        } else if (f.status === "removed") {
          files.push({ status: "removed", path: f.filename });
        } else if (f.status === "added" || f.status === "copied") {
          files.push({ status: "added", path: f.filename });
        } else {
          files.push({ status: "modified", path: f.filename });
        }
      }
      return { tooLarge: false, files };
    },
  };
}

/** One client per owner, so repos under different accounts can each use their own token. */
export function createOwnerRoutedClient(
  tokenFor: (owner: string) => string | undefined,
  opts: { fetch?: FetchLike; baseUrl?: string } = {},
): GitHubClient {
  const clients = new Map<string, GitHubClient>();
  const pick = (repo: RepoRef): GitHubClient => {
    const key = repo.owner.toLowerCase();
    let client = clients.get(key);
    if (!client) {
      client = createGitHubClient({ ...opts, token: tokenFor(key) });
      clients.set(key, client);
    }
    return client;
  };
  return {
    getRepo: (repo) => pick(repo).getRepo(repo),
    getHeadSha: (repo, branch) => pick(repo).getHeadSha(repo, branch),
    downloadTarball: (repo, sha, accept) => pick(repo).downloadTarball(repo, sha, accept),
    compare: (repo, base, head) => pick(repo).compare(repo, base, head),
  };
}

/** Streams a (gzipped) tarball into memory, keeping regular files only. */
export async function extractTarball(
  stream: NodeJS.ReadableStream,
  accept: (path: string, size: number) => boolean,
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const parser = new Parser({
    onReadEntry: (entry: ReadEntry) => {
      const path = stripTopLevel(entry.path);
      const isFile = entry.type === "File" || entry.type === "OldFile" || entry.type === "ContiguousFile";
      if (!path || !isFile || !accept(path, entry.size)) {
        entry.resume();
        return;
      }
      const parts: Buffer[] = [];
      entry.on("data", (c: Buffer) => parts.push(c));
      entry.on("end", () => files.set(path, Buffer.concat(parts)));
    },
  });
  await pipeline(stream, parser as unknown as NodeJS.WritableStream);
  return files;
}

/** Drops GitHub's `owner-repo-sha/` folder; refuses absolute or `..` paths. */
function stripTopLevel(p: string): string | null {
  const segs = p.replace(/\\/g, "/").split("/").slice(1);
  if (segs.length === 0 || segs.some((s) => s === ".." || s === ".")) return null;
  const out = segs.filter(Boolean).join("/");
  return out || null;
}
