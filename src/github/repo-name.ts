import { z } from "zod";

// GitHub's own rules: owner 1-39 alnum/hyphen (no leading hyphen), name 1-100 of [A-Za-z0-9._-].
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export type RepoRef = { owner: string; name: string };

export const repoFullNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, ""))
  .pipe(
    z.string().refine((s) => {
      const [owner, name, ...rest] = s.split("/");
      return rest.length === 0 && OWNER_RE.test(owner ?? "") && NAME_RE.test(name ?? "") && name !== "." && name !== "..";
    }, "Expected owner/name"),
  )
  .transform((s): RepoRef => {
    const [owner, name] = s.split("/");
    return { owner, name };
  });

export function parseRepoFullName(input: string): RepoRef {
  return repoFullNameSchema.parse(input);
}

export function formatRepo(r: RepoRef): string {
  return `${r.owner}/${r.name}`;
}
