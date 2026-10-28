import { proposalSchema, proposalSummariesSchema, revisionsSchema, treeSchema } from "@/core/api-schemas";
import { fetchJson } from "@/lib/fetch-json";

export const fetchTree = () => fetchJson("/api/wiki/tree", treeSchema);
export const fetchProposals = () => fetchJson("/api/wiki/proposals", proposalSummariesSchema);
export const fetchProposal = (revisionId: string) =>
  fetchJson(`/api/wiki/proposals/${encodeURIComponent(revisionId)}`, proposalSchema);
export const fetchRevisions = (pageId: string) =>
  fetchJson(`/api/wiki/pages/${encodeURIComponent(pageId)}/revisions`, revisionsSchema);
