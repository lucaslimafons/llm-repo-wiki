import { z } from "zod";
import { MAX_CONTEXT_CHARS, WIKI_LAYOUTS } from "@/project/schema";

/** Client-safe: no db imports. */
export const MAX_WIKI_NAME_CHARS = 60;
const SLUG_MAX = 40;

export const wikiSlugSchema = z
  .string()
  .max(SLUG_MAX)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens");

/** "My Project!" → "my-project". Empty when the name has no letters or digits. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

export const wikiNameSchema = z.string().trim().min(1, "Give the wiki a name").max(MAX_WIKI_NAME_CHARS);

export const createWikiInputSchema = z.object({
  name: wikiNameSchema,
  context: z.string().trim().max(MAX_CONTEXT_CHARS).default(""),
  layout: z.enum(WIKI_LAYOUTS).default("topic"),
});
export type CreateWikiInput = z.input<typeof createWikiInputSchema>;

export type WikiRef = { id: string; slug: string; name: string };
export type WikiListItem = WikiRef & { repoCount: number; pageCount: number };
