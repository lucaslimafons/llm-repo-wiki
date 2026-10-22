import type { SearchHit, SearchInput } from "@/core/contracts";

/** Hybrid (vector + full-text, RRF) search. Implemented by the ingest/search track. */
export async function searchKnowledge(_input: SearchInput): Promise<SearchHit[]> {
  throw new Error("searchKnowledge: not implemented yet");
}
