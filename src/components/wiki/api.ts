import { proposalSchema, proposalSummariesSchema, revisionsSchema, treeSchema } from "@/core/api-schemas";
import { fetchJson } from "@/lib/fetch-json";
import { apiBase } from "@/wiki/routes";

export const fetchTree = (slug: string) => fetchJson(`${apiBase(slug)}/wiki/tree`, treeSchema);
export const fetchProposals = (slug: string) => fetchJson(`${apiBase(slug)}/wiki/proposals`, proposalSummariesSchema);
export const fetchProposal = (slug: string, revisionId: string) =>
  fetchJson(`${apiBase(slug)}/wiki/proposals/${encodeURIComponent(revisionId)}`, proposalSchema);
export const fetchRevisions = (slug: string, pageId: string) =>
  fetchJson(`${apiBase(slug)}/wiki/pages/${encodeURIComponent(pageId)}/revisions`, revisionsSchema);
