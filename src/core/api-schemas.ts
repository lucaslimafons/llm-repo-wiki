import { z } from "zod";
import type { ChatSummary } from "@/agent/chat-store";
import type { WikiUIMessage } from "@/agent/tools";
import type { Citation, RevisionSummary, TreeNode } from "@/core/contracts";
import type { RepoListItem } from "@/ingest/repos";
import type { ProposalView, RevisionDetail } from "@/wiki/store";

/**
 * Response schemas for the app's own JSON routes, parsed by the client fetchers. Each is typed
 * against the server type it mirrors, so a server-side shape change fails typecheck here.
 */
const isoDate = z.string().min(1);

export const repoListSchema: z.ZodType<RepoListItem[]> = z.array(
  z.object({
    id: z.string(),
    fullName: z.string(),
    defaultBranch: z.string().nullable(),
    status: z.enum(["idle", "queued", "syncing", "error"]),
    desiredSha: z.string().nullable(),
    syncedSha: z.string().nullable(),
    lastError: z.string().nullable(),
    lastSyncedAt: isoDate.nullable(),
    fileCount: z.number(),
  }),
);

export const treeSchema: z.ZodType<TreeNode[]> = z.array(
  z.lazy(() =>
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      sortKey: z.number(),
      stale: z.boolean(),
      hasPendingProposal: z.boolean(),
      children: treeSchema,
    }),
  ),
);

const citationSchema: z.ZodType<Citation> = z.object({
  repo: z.string(),
  path: z.string(),
  commitSha: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});

const revisionSummaryShape = {
  id: z.string(),
  pageId: z.string(),
  status: z.enum(["proposed", "accepted", "rejected"]),
  authorKind: z.enum(["agent", "human"]),
  reason: z.string().nullable(),
  createdAt: isoDate,
} satisfies { [K in keyof RevisionSummary]: z.ZodType<RevisionSummary[K]> };

const revisionDetailShape = {
  ...revisionSummaryShape,
  title: z.string(),
  bodyMd: z.string(),
  parentRevisionId: z.string().nullable(),
  citations: z.array(citationSchema),
  isCurrent: z.boolean(),
};

export const revisionsSchema: z.ZodType<RevisionDetail[]> = z.array(z.object(revisionDetailShape));

export const proposalsSchema: z.ZodType<ProposalView[]> = z.array(
  z.object({
    ...revisionDetailShape,
    pagePath: z.string(),
    isNewPage: z.boolean(),
    currentTitle: z.string(),
    currentBodyMd: z.string(),
    outdated: z.boolean(),
  }),
);

export const chatSummarySchema: z.ZodType<ChatSummary> = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** Message parts were validated against the tool schemas server-side (validateUIMessages). */
const uiMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.looseObject({ type: z.string() })),
}) as unknown as z.ZodType<WikiUIMessage>;

export const chatMessagesSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  messages: z.array(uiMessageSchema),
});

export const pageBodySchema = z.object({
  path: z.string(),
  bodyMd: z.string(),
  revisionId: z.string().nullable(),
});

export const apiErrorSchema = z.object({ error: z.string() });
