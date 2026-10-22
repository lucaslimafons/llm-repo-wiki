/** Every TanStack Query key in the app. Never inline a key literal in a component. */
export const queryKeys = {
  wiki: {
    all: ["wiki"] as const,
    tree: () => ["wiki", "tree"] as const,
    page: (path: string) => ["wiki", "page", path] as const,
    revisions: (pageId: string) => ["wiki", "revisions", pageId] as const,
    proposals: () => ["wiki", "proposals"] as const,
  },
  repos: {
    all: ["repos"] as const,
    list: () => ["repos", "list"] as const,
  },
  chat: {
    all: ["chat"] as const,
    list: () => ["chat", "list"] as const,
    messages: (chatId: string) => ["chat", "messages", chatId] as const,
    pageBody: (path: string) => ["chat", "page-body", path] as const,
  },
} as const;
