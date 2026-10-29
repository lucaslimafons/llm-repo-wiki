"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import type { ActionResult } from "@/ingest/repos";
import type { WikiRef } from "./schema";
import { createWiki, deleteWiki, getWikiBySlug } from "./wikis";

/** Server Action: createWiki zod-validates the untrusted input. */
export async function createWikiAction(input: unknown): Promise<ActionResult<WikiRef>> {
  return createWiki(db(), input);
}

const deleteInputSchema = z.object({ slug: z.string().max(100), confirmName: z.string().max(200) });

/** Deletes only when the typed name matches exactly, then leaves for the wiki list. */
export async function deleteWikiAction(slug: unknown, confirmName: unknown): Promise<ActionResult> {
  const parsed = deleteInputSchema.safeParse({ slug, confirmName });
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const wiki = await getWikiBySlug(db(), parsed.data.slug);
  if (!wiki) return { ok: false, error: "Wiki not found." };
  if (parsed.data.confirmName !== wiki.name) return { ok: false, error: "Type the wiki's name exactly to confirm." };
  if (!(await deleteWiki(db(), wiki.id))) return { ok: false, error: "Wiki not found." };
  redirect("/");
}
