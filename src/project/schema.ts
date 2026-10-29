import { z } from "zod";

/** Capped so the brief, sent with every model call, cannot crowd out the evidence. Client-safe: no db imports. */
export const MAX_CONTEXT_CHARS = 4_000;
export const MAX_ROLE_CHARS = 200;

/** How a multi-repo wiki is laid out; the owner picks it on the wiki's settings page. */
export const WIKI_LAYOUTS = ["topic", "repo"] as const;
export type WikiLayout = (typeof WIKI_LAYOUTS)[number];

export type ProjectContext = {
  name: string;
  context: string;
  layout: WikiLayout;
  repos: { id: string; fullName: string; role: string | null }[];
};

export const projectContextInputSchema = z.object({
  name: z.string().trim().min(1, "Give the wiki a name").max(60),
  context: z.string().trim().max(MAX_CONTEXT_CHARS),
  layout: z.enum(WIKI_LAYOUTS),
  roles: z.array(z.object({ repoId: z.uuid(), role: z.string().trim().max(MAX_ROLE_CHARS) })).max(100),
});
export type ProjectContextInput = z.infer<typeof projectContextInputSchema>;
