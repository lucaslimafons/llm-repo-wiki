import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { repos, wikis } from "@/db/schema";
import type { ActionResult } from "@/ingest/repos";
import { describeIssues } from "@/lib/zod-issues";
import { projectContextInputSchema, WIKI_LAYOUTS, type ProjectContext, type WikiLayout } from "./schema";

/** The wiki's brief, layout and its repos' roles. */
export async function getProjectContext(db: Db, wikiId: string): Promise<ProjectContext> {
  const [settings, repoRows] = await Promise.all([
    db.select({ name: wikis.name, context: wikis.context, layout: wikis.layout }).from(wikis).where(eq(wikis.id, wikiId)),
    db
      .select({ id: repos.id, owner: repos.owner, name: repos.name, role: repos.role })
      .from(repos)
      .where(eq(repos.wikiId, wikiId))
      .orderBy(asc(repos.owner), asc(repos.name)),
  ]);
  return {
    name: settings[0]?.name ?? "",
    context: settings[0]?.context ?? "",
    layout: WIKI_LAYOUTS.find((l) => l === settings[0]?.layout) ?? "topic",
    repos: repoRows.map((r) => ({ id: r.id, fullName: `${r.owner}/${r.name}`, role: r.role })),
  };
}

export async function saveProjectContext(db: Db, wikiId: string, input: unknown): Promise<ActionResult> {
  const parsed = projectContextInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid settings: ${describeIssues(parsed.error)}` };
  const { name, context, layout, roles } = parsed.data;
  const saved = await db.transaction(async (tx) => {
    const updated = await tx
      .update(wikis)
      .set({ name, context, layout, updatedAt: new Date() })
      .where(eq(wikis.id, wikiId))
      .returning({ id: wikis.id });
    if (updated.length === 0) return false;
    // Only this wiki's repos: an unknown or foreign id is ignored rather than trusted.
    const known = roles.length
      ? new Set(
          (
            await tx
              .select({ id: repos.id })
              .from(repos)
              .where(and(eq(repos.wikiId, wikiId), inArray(repos.id, roles.map((r) => r.repoId))))
          ).map((r) => r.id),
        )
      : new Set<string>();
    for (const r of roles.filter((r) => known.has(r.repoId))) {
      await tx.update(repos).set({ role: r.role || null }).where(eq(repos.id, r.repoId));
    }
    return true;
  });
  return saved ? { ok: true, data: undefined } : { ok: false, error: "Wiki not found." };
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
