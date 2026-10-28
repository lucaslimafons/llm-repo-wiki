import { z } from "zod";
import { githubTokensSchema } from "@/github/tokens";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  OPENROUTER_API_KEY: z.string().optional().transform((v) => v || undefined),
  GITHUB_TOKEN: z.string().optional().transform((v) => v || undefined),
  GITHUB_TOKENS: githubTokensSchema,
  GITHUB_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  CHAT_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
  AUTHOR_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
  EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  /** Used only by the /explain view's optional rerank step (the eval's best: hybrid + rerank-4-pro). */
  RERANK_MODEL: z.string().default("cohere/rerank-4-pro"),
  /** Route every model call to zero-data-retention endpoints (see src/lib/openrouter-privacy.ts). */
  OPENROUTER_ZDR: z.stringbool().default(true),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
  /** Input + output tokens one author run may spend before it stops proposing (unset: the author's default). */
  AUTHOR_TOKEN_BUDGET: z.coerce.number().int().min(10_000).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` and unit tests don't need a full .env. */
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

/** Required only where a model or embedding is called, so the wiki stays browsable without a key. */
export function openRouterKey(): string {
  const key = env().OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local (see .env.example).");
  return key;
}
