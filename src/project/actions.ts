"use server";

import { db } from "@/db/client";
import type { ActionResult } from "@/ingest/repos";
import { withWiki } from "@/wikis/server";
import { saveProjectContext } from "./context";

/** Server Action: the input is untrusted, so saveProjectContext zod-validates it first. */
export async function saveProjectContextAction(wikiSlug: string, input: unknown): Promise<ActionResult> {
  return withWiki(wikiSlug, (wiki) => saveProjectContext(db(), wiki.id, input));
}
