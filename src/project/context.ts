import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { projectSettings, repos } from "@/db/schema";
import type { ActionResult } from "@/ingest/repos";
import { projectContextInputSchema, type ProjectContext } from "./schema";

export async function getProjectContext(db: Db): Promise<ProjectContext> {
  const [settings, repoRows] = await Promise.all([
    db.select({ context: projectSettings.context }).from(projectSettings).where(eq(projectSettings.id, 1)),
    db.select({ id: repos.id, owner: repos.owner, name: repos.name, role: repos.role }).from(repos).orderBy(asc(repos.owner), asc(repos.name)),
  ]);
  return {
    context: settings[0]?.context ?? "",
    repos: repoRows.map((r) => ({ id: r.id, fullName: `${r.owner}/${r.name}`, role: r.role })),
  };
}

export async function saveProjectContext(db: Db, input: unknown): Promise<ActionResult> {
  const parsed = projectContextInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid project context: ${parsed.error.issues[0]?.message}` };
  const { context, roles } = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .insert(projectSettings)
      .values({ id: 1, context })
      .onConflictDoUpdate({ target: projectSettings.id, set: { context, updatedAt: new Date() } });
    // Only repos that exist: an unknown id is ignored rather than trusted.
    const known = roles.length
      ? new Set((await tx.select({ id: repos.id }).from(repos).where(inArray(repos.id, roles.map((r) => r.repoId)))).map((r) => r.id))
      : new Set<string>();
    for (const r of roles.filter((r) => known.has(r.repoId))) {
      await tx.update(repos).set({ role: r.role || null }).where(eq(repos.id, r.repoId));
    }
  });
  return { ok: true, data: undefined };
}

/** The prompt section, or null when the owner has written nothing yet. */
export function formatProjectContext(p: ProjectContext): string | null {
  const roles = p.repos.filter((r) => r.role);
  if (!p.context && roles.length === 0) return null;
  return [
    `## Project context (written by the wiki owner)`,
    `The repositories below are parts of ONE project, documented as one wiki. Shared pages (Overview, Architecture, Guides) describe the whole project; a part that only one repository has belongs on its own page. Treat this brief as the owner's intent, but cite the code for every fact.`,
    ...(p.context ? [p.context] : []),
    `Repositories:\n${p.repos.map((r) => `- ${r.fullName}${r.role ? `: ${r.role}` : ""}`).join("\n")}`,
  ].join("\n\n");
}
