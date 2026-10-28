import { z } from "zod";
import type { ChatSummary } from "@/agent/chat-store";
import type { WikiUIMessage } from "@/agent/tools";
import type { Citation, RevisionSummary, SearchHit, TreeNode } from "@/core/contracts";
import type { RepoListItem } from "@/ingest/repos";
import type { JobsOverview } from "@/jobs/overview";
import type { RepoTimeline } from "@/jobs/timeline";
import type { ExplainAnswer } from "@/agent/explain-answer";
import type { SearchExplanation } from "@/search/explain";
import type { ProposalSummary, ProposalView, RevisionDetail } from "@/wiki/store";

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

const STEP_STATE = z.enum(["idle", "waiting", "running", "done", "stopped", "failed"]);

export const jobsOverviewSchema: z.ZodType<JobsOverview> = z.object({
  asOf: isoDate,
  pipelines: z.array(
    z.object({
      repoId: z.string(),
      fullName: z.string(),
      role: z.string().nullable(),
      lastError: z.string().nullable(),
      sync: z.object({
        state: STEP_STATE,
        startedAt: isoDate.nullable(),
        finishedAt: isoDate.nullable(),
        indexed: z.number().nullable(),
        embedded: z.number().nullable(),
        secretsDropped: z.array(z.string()),
      }),
      author: z.object({
        state: STEP_STATE,
        queuePosition: z.number().nullable(),
        startedAt: isoDate.nullable(),
        finishedAt: isoDate.nullable(),
        planned: z.number().nullable(),
        proposed: z.number(),
        dropped: z.number(),
        skipped: z.number(),
        skipReasons: z.array(z.string()),
        current: z.string().nullable(),
        tokens: z.number(),
        costUsd: z.number(),
        status: z.string().nullable(),
      }),
      pendingReview: z.number(),
    }),
  ),
  jobs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      state: z.string(),
      retryCount: z.number(),
      createdOn: isoDate,
      startedOn: isoDate.nullable(),
      completedOn: isoDate.nullable(),
      error: z.string().nullable(),
      repo: z.string().nullable(),
    }),
  ),
  runs: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      model: z.string(),
      status: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
      error: z.string().nullable(),
      startedAt: isoDate,
      finishedAt: isoDate.nullable(),
      repo: z.string().nullable(),
    }),
  ),
  activity: z.array(
    z.object({
      at: isoDate,
      action: z.string(),
      repo: z.string().nullable(),
      details: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  totalCostUsd: z.number(),
});

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

export const proposalSchema: z.ZodType<ProposalView> = z.object({
  ...revisionDetailShape,
  pagePath: z.string(),
  isNewPage: z.boolean(),
  currentTitle: z.string(),
  currentBodyMd: z.string(),
  outdated: z.boolean(),
});

export const proposalSummariesSchema: z.ZodType<ProposalSummary[]> = z.array(
  z.object({
    ...revisionSummaryShape,
    title: z.string(),
    pagePath: z.string(),
    isNewPage: z.boolean(),
    outdated: z.boolean(),
    citationCount: z.number(),
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

export const repoTimelineSchema: z.ZodType<RepoTimeline> = z.object({
  asOf: isoDate,
  repos: z.array(z.object({ id: z.string(), fullName: z.string() })),
  repo: z.object({ id: z.string(), fullName: z.string(), status: z.string() }).nullable(),
  runs: z.array(z.object({ key: z.string(), at: isoDate, fromSha: z.string().nullable(), toSha: z.string().nullable() })),
  selected: z.string().nullable(),
  events: z.array(z.object({ at: isoDate, action: z.string(), details: z.record(z.string(), z.unknown()) })),
  live: z.boolean(),
  pendingReview: z.number(),
});

const searchHitSchema: z.ZodType<SearchHit> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("source"),
    chunkId: z.string(),
    repo: z.string(),
    path: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    commitSha: z.string(),
    symbol: z.string().nullable(),
    content: z.string(),
    score: z.number(),
  }),
  z.object({
    kind: z.literal("wiki"),
    pageId: z.string(),
    pagePath: z.string(),
    headingPath: z.string().nullable(),
    content: z.string(),
    score: z.number(),
  }),
]);

const explainItemShape = {
  key: z.string(),
  hit: searchHitSchema,
  ftsRank: z.number().nullable(),
  vecRank: z.number().nullable(),
  ftsScore: z.number().nullable(),
  vecSimilarity: z.number().nullable(),
  fusedRank: z.number(),
  fusedScore: z.number(),
};

export const searchExplanationSchema: z.ZodType<SearchExplanation> = z.object({
  query: z.string(),
  tsquery: z.string(),
  embedding: z.object({ model: z.string(), dims: z.number(), preview: z.array(z.number()) }).nullable(),
  rrfK: z.number(),
  candidates: z.object({ fts: z.number(), vector: z.number(), fused: z.number() }),
  fts: z.array(z.object(explainItemShape)),
  vector: z.array(z.object(explainItemShape)),
  fused: z.array(z.object(explainItemShape)),
  reranked: z
    .object({ model: z.string(), costUsd: z.number(), items: z.array(z.object({ ...explainItemShape, rerankScore: z.number() })) })
    .nullable(),
  rerankAvailable: z.boolean(),
});

export const explainAnswerSchema: z.ZodType<ExplainAnswer> = z.object({
  answerMd: z.string(),
  kept: z.array(citationSchema),
  stripped: z.array(z.string()),
  tokens: z.number(),
  costUsd: z.number(),
});
