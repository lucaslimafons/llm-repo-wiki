import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  GITHUB_TOKEN: z.string().optional().transform((v) => v || undefined),
  GITHUB_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  CHAT_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  AUTHOR_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
  EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  POLL_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` and unit tests don't need a full .env. */
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
