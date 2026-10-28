import type { z } from "zod";

/** Every issue as "field: message", so a 400 says what to fix rather than "invalid request". */
export function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}
