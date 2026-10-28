import { WikiError } from "./errors";
import type { WikiStoreExt } from "./store";

export type BulkDecision = { done: number; failed: { revisionId: string; path: string; error: string }[] };

/**
 * Accepts parents before their children (a new child under a never-accepted parent stays hidden
 * otherwise) and rejects children first (so an emptied new parent can be removed). One failure,
 * e.g. an outdated proposal, does not stop the rest.
 */
export async function decideProposals(store: WikiStoreExt, revisionIds: string[], accept: boolean): Promise<BulkDecision> {
  const wanted = new Set(revisionIds);
  const depth = (path: string) => path.split("/").length;
  const queue = (await store.listProposalSummaries())
    .filter((p) => wanted.has(p.id))
    .sort((a, b) => (accept ? depth(a.pagePath) - depth(b.pagePath) : depth(b.pagePath) - depth(a.pagePath)));
  const result: BulkDecision = { done: 0, failed: [] };
  for (const p of queue) {
    try {
      await (accept ? store.acceptRevision(p.id) : store.rejectRevision(p.id));
      result.done++;
    } catch (err) {
      if (!(err instanceof WikiError)) throw err;
      result.failed.push({ revisionId: p.id, path: p.pagePath, error: err.message });
    }
  }
  return result;
}
