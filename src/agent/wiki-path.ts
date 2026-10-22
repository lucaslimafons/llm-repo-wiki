import { z } from "zod";
import { parseSourceHref } from "@/lib/source-links";
import type { Citation } from "@/core/contracts";

/** Azure DevOps caps a page's full path at 235 characters. */
export const MAX_WIKI_PATH = 235;

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Local mirror of Track B's title rules (src/wiki/title.ts); the lead swaps this import at merge.
 * No `/ \ #`, no leading/trailing `.`, no control characters.
 */
export const pageTitleSchema = z
  .string()
  .trim()
  .min(1, "title is empty")
  .max(MAX_WIKI_PATH, "title is too long")
  .refine((t) => !/[/\\#]/.test(t), "title must not contain / \\ or #")
  .refine((t) => !t.startsWith(".") && !t.endsWith("."), "title must not start or end with '.'")
  .refine((t) => !CONTROL.test(t), "title must not contain control characters");

/**
 * A display path ("Architecture/Ingestion") from the model. Resolved to an id server-side, so a
 * traversal or absolute path is refused here before it can reach the store.
 */
export const wikiPathSchema = z
  .string()
  .min(1, "path is empty")
  .max(MAX_WIKI_PATH, `path exceeds ${MAX_WIKI_PATH} characters`)
  .refine((p) => !CONTROL.test(p), "path must not contain control characters")
  .refine((p) => !p.includes("\\"), "path must not contain backslashes")
  .refine((p) => !p.startsWith("/"), "path must be relative to the wiki root (no leading /)")
  .refine(
    (p) => p.split("/").every((seg) => seg.trim() !== "" && seg !== "." && seg !== ".."),
    "path must not contain empty, '.' or '..' segments",
  )
  .refine((p) => p.split("/").every((seg) => pageTitleSchema.safeParse(seg).success), "a path segment is not a valid page title");

/** Citations arrive in the same `source:` format the body uses, so one parser checks both. */
export const citationHrefSchema = z
  .string()
  .max(600)
  .transform((href, ctx): Citation => {
    const c = parseSourceHref(href.trim());
    if (!c) {
      ctx.addIssue({ code: "custom", message: `not a source citation: ${href.slice(0, 80)}` });
      return z.NEVER;
    }
    return c;
  });

export function joinWikiPath(parentPath: string | null | undefined, title: string): string {
  return parentPath ? `${parentPath}/${title}` : title;
}

export function parentOf(path: string): string | null {
  const i = path.lastIndexOf("/");
  return i === -1 ? null : path.slice(0, i);
}
