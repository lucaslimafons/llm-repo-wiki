import type { z } from "zod";
import { apiErrorSchema } from "@/core/api-schemas";

/** Fetches one of the app's JSON routes and parses it, so a drifted response fails here, loudly. */
export async function fetchJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new Error(error.success ? error.data.error : `${url}: ${res.status} ${res.statusText}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`${url}: unexpected response (${parsed.error.issues[0]?.message ?? "invalid"})`);
  return parsed.data;
}
