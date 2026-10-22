export type WikiErrorCode =
  | "not_found"
  | "invalid"
  | "title_taken"
  | "conflict"
  | "has_children"
  | "cycle";

/** Every expected store failure. `message` is safe to show a user or return to the model. */
export class WikiError extends Error {
  constructor(
    readonly code: WikiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WikiError";
  }
}

/** Drizzle wraps driver errors in DrizzleQueryError, so look at the cause chain too. */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === "23505";
export const isForeignKeyViolation = (err: unknown) => pgErrorCode(err) === "23503";
