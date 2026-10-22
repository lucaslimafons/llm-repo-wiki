import { createHash } from "node:crypto";
import type { CompareFile, GitHubClient } from "@/github/client";
import { fakeEmbedding } from "@/test/db";
import type { Embedder } from "./embedder";

export type FakeEmbedder = Embedder & { calls: number; texts: string[]; failWhen?: (text: string) => boolean };

const seedOf = (text: string) => createHash("sha256").update(text).digest().readUInt32BE(0) % 100_000;

/** Deterministic vectors; records every text so tests can assert what was (not) re-embedded. */
export function fakeEmbedder(overrides: Record<string, number[]> = {}): FakeEmbedder {
  const e: FakeEmbedder = {
    model: "fake-embedding",
    calls: 0,
    texts: [],
    async embed(texts) {
      e.calls++;
      if (e.failWhen && texts.some(e.failWhen)) throw new Error("429 Too Many Requests");
      e.texts.push(...texts);
      return texts.map((t) => overrides[t] ?? fakeEmbedding(seedOf(t)));
    },
  };
  return e;
}

export type Snapshot = Record<string, string>;

/**
 * GitHub over in-memory commits. Compare is computed from the two snapshots the way GitHub
 * reports it, including renames (a removed and an added file with identical bytes).
 */
export function fakeGitHub(commits: Record<string, Snapshot>, opts: { branch?: string; head?: string } = {}) {
  const state = { head: opts.head ?? Object.keys(commits).at(-1)!, tarballs: 0, compares: 0, tooLarge: false };
  const client: GitHubClient = {
    async getRepo() {
      return { defaultBranch: opts.branch ?? "main", private: false };
    },
    async getHeadSha() {
      return state.head;
    },
    async downloadTarball(_repo, sha, accept = () => true) {
      state.tarballs++;
      const snap = commits[sha];
      if (!snap) throw new Error(`no commit ${sha}`);
      const out = new Map<string, Buffer>();
      for (const [p, text] of Object.entries(snap)) {
        const buf = Buffer.from(text);
        if (accept(p, buf.length)) out.set(p, buf);
      }
      return out;
    },
    async compare(_repo, base, head) {
      state.compares++;
      if (state.tooLarge) return { tooLarge: true };
      const a = commits[base];
      const b = commits[head];
      const files: CompareFile[] = [];
      const removed = Object.keys(a).filter((p) => !(p in b));
      const added = Object.keys(b).filter((p) => !(p in a));
      for (const p of added) {
        const from = removed.find((r) => a[r] === b[p]);
        if (from) {
          removed.splice(removed.indexOf(from), 1);
          files.push({ status: "renamed", path: p, previousPath: from });
        } else files.push({ status: "added", path: p });
      }
      for (const p of removed) files.push({ status: "removed", path: p });
      for (const p of Object.keys(b)) if (p in a && a[p] !== b[p]) files.push({ status: "modified", path: p });
      return { tooLarge: false, files };
    },
  };
  return { client, state };
}

export const sha = (n: number) => n.toString(16).padStart(40, "0");
