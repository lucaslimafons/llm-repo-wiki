"use server";

import { db } from "@/db/client";
import type { ActionResult } from "@/ingest/repos";
import { saveProjectContext } from "./context";

/** Server Action: the input is untrusted, so saveProjectContext zod-validates it first. */
export async function saveProjectContextAction(input: unknown): Promise<ActionResult> {
  return saveProjectContext(db(), input);
}
