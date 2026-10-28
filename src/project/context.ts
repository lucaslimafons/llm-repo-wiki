import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { projectSettings, repos } from "@/db/schema";
import type { ActionResult } from "@/ingest/repos";
import { projectContextInputSchema, WIKI_LAYOUTS, type ProjectContext, type WikiLayout } from "./schema";

export async function getProjectContext(db: Db): Promise<ProjectContext> {
  const [settings, repoRows] = await Promise.all([
    db.select({ context: projectSettings.context, layout: projectSettings.layout }).from(projectSettings).where(eq(projectSettings.id, 1)),
    db.select({ id: repos.id, owner: repos.owner, name: repos.name, role: repos.role }).from(repos).orderBy(asc(repos.owner), asc(repos.name)),
  ]);
  return {
    context: settings[0]?.context ?? "",
    layout: WIKI_LAYOUTS.find((l) => l === settings[0]?.layout) ?? "topic",
    repos: repoRows.map((r) => ({ id: r.id, fullName: `${r.owner}/${r.name}`, role: r.role })),
  };
}

export async function saveProjectContext(db: Db, input: unknown): Promise<ActionResult> {
  const parsed = projectContextInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid project context: ${parsed.error.issues[0]?.message}` };
  const { context, layout, roles } = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .insert(projectSettings)
      .values({ id: 1, context, layout })
      .onConflictDoUpdate({ target: projectSettings.id, set: { context, layout, updatedAt: new Date() } });
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

const PROJECT_LEVEL = `Whatever the layout, the top-level \`Overview\` and \`Architecture\` pages describe the WHOLE project: what each repository does and how they connect (an \`Architecture\` mermaid graph of the parts and the calls between them).`;

const LAYOUT_RULES: Record<WikiLayout, (repoNames: string[]) => string> = {
  topic: () =>
    `Layout: BY TOPIC. One shared tree. Each repository's subsystems go in an \`Architecture/<part>\` folder named for its role (e.g. \`Architecture/Mobile App\`); \`Guides\`, \`Reference\` and \`Glossary\` are shared by all repositories.`,
  repo: (names) =>
    `Layout: BY REPOSITORY. After the project-level \`Overview\` and \`Architecture\`, each repository gets ONE top-level folder named exactly after it (${names.map((n) => `\`${n}\``).join(", ")}) holding that repository's own Architecture, Guides and Reference pages. Never put one repository's pages in another's folder.`,
};

/** The prompt section, or null for a lone repo the owner has said nothing about. */
export function formatProjectContext(p: ProjectContext): string | null {
  const roles = p.repos.filter((r) => r.role);
  if (!p.context && roles.length === 0 && p.repos.length < 2) return null;
  return [
    `## Project context (written by the wiki owner)`,
    `The repositories below are parts of ONE project, documented as one wiki. Treat this brief as the owner's intent, but cite the code for every fact.`,
    ...(p.context ? [p.context] : []),
    `Repositories:\n${p.repos.map((r) => `- ${r.fullName}${r.role ? `: ${r.role}` : ""}`).join("\n")}`,
    PROJECT_LEVEL,
    LAYOUT_RULES[p.layout](p.repos.map((r) => r.fullName.split("/")[1])),
  ].join("\n\n");
}
