/** Every TanStack Query key in the app. Never inline a key literal in a component. Keys start with the wiki slug, so wikis never share a cache entry. */
export const queryKeys = {
  wikis: {
    list: () => ["wikis"] as const,
  },
  wiki: {
    all: (slug: string) => ["w", slug, "wiki"] as const,
    tree: (slug: string) => ["w", slug, "wiki", "tree"] as const,
    page: (slug: string, path: string) => ["w", slug, "wiki", "page", path] as const,
    revisions: (slug: string, pageId: string) => ["w", slug, "wiki", "revisions", pageId] as const,
    proposals: (slug: string) => ["w", slug, "wiki", "proposals"] as const,
    proposal: (slug: string, revisionId: string) => ["w", slug, "wiki", "proposal", revisionId] as const,
  },
  repos: {
    all: (slug: string) => ["w", slug, "repos"] as const,
    list: (slug: string) => ["w", slug, "repos", "list"] as const,
  },
  jobs: {
    overview: (slug: string) => ["w", slug, "jobs", "overview"] as const,
    timeline: (slug: string, repoId: string | null, run: string | null) => ["w", slug, "jobs", "timeline", repoId, run] as const,
  },
  explain: {
    search: (slug: string, query: string) => ["w", slug, "explain", "search", query] as const,
  },
  chat: {
    all: (slug: string) => ["w", slug, "chat"] as const,
    list: (slug: string) => ["w", slug, "chat", "list"] as const,
    messages: (slug: string, chatId: string) => ["w", slug, "chat", "messages", chatId] as const,
    pageBody: (slug: string, path: string) => ["w", slug, "chat", "page-body", path] as const,
  },
} as const;
