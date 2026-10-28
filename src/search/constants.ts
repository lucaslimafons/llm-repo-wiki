/** Search numbers shared across modules (search, explainer, eval, and the client). Dependency-free, client-safe. */

/** Reciprocal Rank Fusion constant: each list adds 1/(RRF_K + rank). */
export const RRF_K = 60;
/** Candidates per retriever before fusion. */
export const CANDIDATES = 50;
/** Fused hits a reranker re-orders (the eval's pool). */
export const RERANK_POOL = 30;
/** Chunks the /explain answer may read: the top of the list the reader is looking at. */
export const MAX_ANSWER_CHUNKS = 8;
