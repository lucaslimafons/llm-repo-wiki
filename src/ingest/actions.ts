"use server";

import { withWiki } from "@/wikis/server";
import { prodRepoDeps } from "./deps";
import * as core from "./repos";

/** Server Actions: inputs are untrusted, so each core function zod-validates before touching anything. */
export async function addRepoAction(wikiSlug: string, fullName: string): Promise<core.ActionResult<{ id: string }>> {
  return withWiki(wikiSlug, (wiki) => core.addRepo(prodRepoDeps(), wiki.id, fullName));
}

export async function removeRepoAction(wikiSlug: string, id: string): Promise<core.ActionResult> {
  return withWiki(wikiSlug, (wiki) => core.removeRepo(prodRepoDeps(), wiki.id, id));
}

export async function syncRepoNowAction(wikiSlug: string, id: string): Promise<core.ActionResult> {
  return withWiki(wikiSlug, (wiki) => core.syncRepoNow(prodRepoDeps(), wiki.id, id));
}
