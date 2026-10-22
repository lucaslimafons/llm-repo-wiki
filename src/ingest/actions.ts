"use server";

import { prodRepoDeps } from "./deps";
import * as core from "./repos";

/** Server Actions: inputs are untrusted, so each core function zod-validates before touching anything. */
export async function addRepoAction(fullName: string): Promise<core.ActionResult<{ id: string }>> {
  return core.addRepo(prodRepoDeps(), fullName);
}

export async function removeRepoAction(id: string): Promise<core.ActionResult> {
  return core.removeRepo(prodRepoDeps(), id);
}

export async function syncRepoNowAction(id: string): Promise<core.ActionResult> {
  return core.syncRepoNow(prodRepoDeps(), id);
}
