import { z } from "zod";

/** Path cap borrowed from Azure DevOps wikis; we measure the "Parent/Child" display path. */
export const MAX_PAGE_PATH_LENGTH = 235;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * A page title under rules borrowed from Azure DevOps wikis, which keep titles safe as file and
 * path names anywhere. Trimmed first, so " Setup " is stored as "Setup".
 * Sibling uniqueness needs the database, and the full-path cap needs the parent: the store checks both.
 */
export const pageTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(MAX_PAGE_PATH_LENGTH, `Title must be at most ${MAX_PAGE_PATH_LENGTH} characters`)
  .refine((t) => !/[/\\#]/.test(t), "Title cannot contain / \\ or #")
  .refine((t) => !t.startsWith(".") && !t.endsWith("."), "Title cannot start or end with a period")
  .refine((t) => !CONTROL_CHARS.test(t), "Title cannot contain control characters");

export function joinPath(parentPath: string | null, title: string): string {
  return parentPath ? `${parentPath}/${title}` : title;
}

/** Full-path rule: the display path of the page (and so of every descendant) stays ≤ 235. */
export const fullPathSchema = z
  .string()
  .max(MAX_PAGE_PATH_LENGTH, `Page path must be at most ${MAX_PAGE_PATH_LENGTH} characters`);
