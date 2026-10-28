/** Every TanStack Query key in the app. Never inline a key literal in a component. */
export const queryKeys = {
  wiki: {
    all: ["wiki"] as const,
    tree: () => ["wiki", "tree"] as const,
    page: (path: string) => ["wiki", "page", path] as const,
    revisions: (pageId: string) => ["wiki", "revisions", pageId] as const,
    proposals: () => ["wiki", "proposals"] as const,
    proposal: (revisionId: string) => ["wiki", "proposal", revisionId] as const,
  },
  repos: {
    all: ["repos"] as const,
    list: () => ["repos", "list"] as const,
  },
  jobs: {
    overview: () => ["jobs", "overview"] as const,
    timeline: (repoId: string | null, run: string | null) => ["jobs", "timeline", repoId, run] as const,
  },
  explain: {
    search: (query: string, rerank: boolean) => ["explain", "search", query, rerank] as const,
  },
  chat: {
    all: ["chat"] as const,
    list: () => ["chat", "list"] as const,
    messages: (chatId: string) => ["chat", "messages", chatId] as const,
    pageBody: (path: string) => ["chat", "page-body", path] as const,
  },
} as const;
