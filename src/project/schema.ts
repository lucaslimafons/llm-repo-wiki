import { z } from "zod";

/** Capped so the brief, sent with every model call, cannot crowd out the evidence. Client-safe: no db imports. */
export const MAX_CONTEXT_CHARS = 4_000;
export const MAX_ROLE_CHARS = 200;

export type ProjectContext = {
  context: string;
  repos: { id: string; fullName: string; role: string | null }[];
};

export const projectContextInputSchema = z.object({
  context: z.string().trim().max(MAX_CONTEXT_CHARS),
  roles: z.array(z.object({ repoId: z.uuid(), role: z.string().trim().max(MAX_ROLE_CHARS) })).max(100),
});
export type ProjectContextInput = z.infer<typeof projectContextInputSchema>;
