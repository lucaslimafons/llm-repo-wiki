import type { TreeNode } from "@/core/contracts";
import type { ProposalView, RevisionDetail } from "@/wiki/store";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchTree = () => getJson<TreeNode[]>("/api/wiki/tree");
export const fetchProposals = () => getJson<ProposalView[]>("/api/wiki/proposals");
export const fetchRevisions = (pageId: string) => getJson<RevisionDetail[]>(`/api/wiki/pages/${pageId}/revisions`);
