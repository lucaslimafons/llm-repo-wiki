import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { repos } from "@/db/schema";
import type { GitHubClient } from "@/github/client";

/** Checks every repo's default-branch head; a moved head (or a lost enqueue) gets a sync. */
export async function pollRepos(deps: { db: Db; github: GitHubClient; enqueueSync: (repoId: string) => Promise<unknown> }) {
  const { db, github } = deps;
  const all = await db.select().from(repos);
  let enqueued = 0;
  for (const r of all) {
    const ref = { owner: r.owner, name: r.name };
    try {
      const branch = r.defaultBranch ?? (await github.getRepo(ref)).defaultBranch;
      const head = await github.getHeadSha(ref, branch);
      const moved = head !== r.desiredSha;
      const stranded = head !== r.syncedSha && r.status === "idle";
      await db
        .update(repos)
        .set({
          defaultBranch: branch,
          lastPolledAt: new Date(),
          ...(moved ? { desiredSha: head } : {}),
          ...((moved || stranded) && r.status !== "syncing" ? { status: "queued" as const } : {}),
        })
        .where(eq(repos.id, r.id));
      if (moved || stranded) {
        await deps.enqueueSync(r.id);
        enqueued++;
      }
    } catch (err) {
      // One unreachable repo must not stop the others from being polled.
      console.warn(`[poll] ${r.owner}/${r.name}:`, (err as Error).message);
    }
  }
  return { polled: all.length, enqueued };
}
