import { z } from "zod";

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * `GITHUB_TOKENS=owner=token,other-owner=token`: one fine-grained token covers one owner, so repos
 * under several accounts need one each. Owners are case-insensitive on GitHub, so keys are lowercased.
 * Issue messages never include the token itself.
 */
export const githubTokensSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const tokens = new Map<string, string>();
    for (const entry of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const eq = entry.indexOf("=");
      const owner = entry.slice(0, Math.max(eq, 0)).trim();
      const token = entry.slice(eq + 1).trim();
      if (eq <= 0 || !OWNER_RE.test(owner) || !token) {
        ctx.addIssue({ code: "custom", message: "GITHUB_TOKENS entries must look like owner=token" });
        return z.NEVER;
      }
      const key = owner.toLowerCase();
      if (tokens.has(key)) {
        ctx.addIssue({ code: "custom", message: `GITHUB_TOKENS lists ${owner} twice` });
        return z.NEVER;
      }
      tokens.set(key, token);
    }
    return tokens;
  });

/** The owner's own token, else the default `GITHUB_TOKEN` (fine for public repos and rate limits). */
export function tokenForOwner(tokens: Map<string, string>, fallback: string | undefined, owner: string): string | undefined {
  return tokens.get(owner.toLowerCase()) ?? fallback;
}
