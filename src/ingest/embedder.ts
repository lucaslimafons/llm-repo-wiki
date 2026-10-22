import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

export interface Embedder {
  /** Stored as `embedding_model` on every row, so a model mix is detectable. */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_BATCH = 64;

/**
 * OpenRouter via the AI SDK. A 429/5xx surfaces as a thrown APICallError after the SDK's own
 * retries, which fails the job so pg-boss retries it with backoff. Never catch it here.
 */
export function createOpenRouterEmbedder(opts: { apiKey: string; model: string; batchSize?: number }): Embedder {
  const provider = createOpenRouter({ apiKey: opts.apiKey });
  const model = provider.textEmbeddingModel(opts.model);
  const batchSize = opts.batchSize ?? EMBED_BATCH;
  return {
    model: opts.model,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const { embeddings } = await embedMany({ model, values: texts.slice(i, i + batchSize) });
        for (const e of embeddings) {
          if (e.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(`${opts.model} returned ${e.length} dims; the schema expects ${EMBEDDING_DIMENSIONS}`);
          }
          out.push(e);
        }
      }
      return out;
    },
  };
}

/** pgvector literal. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
