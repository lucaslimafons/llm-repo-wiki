/** Dependency-free so the chat UI can import it without bundling the tool factory. */
export const WRITE_TOOL_NAMES = ["createPage", "updatePage", "movePage", "deletePage"] as const;

/** Destructive or overwriting tools wait for a human click; the rest run straight away. */
export const WIKI_TOOL_APPROVAL = {
  updatePage: "user-approval",
  movePage: "user-approval",
  deletePage: "user-approval",
} as const;
