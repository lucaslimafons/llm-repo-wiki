import type { WikiStore } from "@/core/contracts";

const notImplemented = () => {
  throw new Error("wikiStore: not implemented yet");
};

/** Postgres-backed wiki. Implemented by the wiki track. */
export const wikiStore: WikiStore = {
  listTree: notImplemented,
  getPage: notImplemented,
  createPage: notImplemented,
  updatePage: notImplemented,
  movePage: notImplemented,
  deletePage: notImplemented,
  listRevisions: notImplemented,
  acceptRevision: notImplemented,
  rejectRevision: notImplemented,
  markStaleByFiles: notImplemented,
};
