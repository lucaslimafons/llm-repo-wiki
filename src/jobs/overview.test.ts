import { beforeEach, describe, expect, it } from "vitest";
import { agentRuns, repos, wikiLog } from "@/db/schema";
import { jobsOverviewSchema } from "@/core/api-schemas";
import { resetDb, testDb } from "@/test/db";
import { getJobsOverview } from "./overview";

const db = testDb();

describe("getJobsOverview", () => {
  beforeEach(resetDb);

  it("reports repos, runs newest first, activity with repo names, and the total spend", async () => {
    const [repo] = await db.insert(repos).values({ owner: "acme", name: "widgets", status: "syncing" }).returning();
    await db.insert(agentRuns).values([
      { kind: "author", model: "m", status: "succeeded", costUsd: "0.25", startedAt: new Date("2026-01-01T00:00:00Z"), finishedAt: new Date("2026-01-01T00:05:00Z") },
      { kind: "chat", model: "m", status: "running", costUsd: "0.01", startedAt: new Date("2026-01-02T00:00:00Z") },
    ]);
    await db.insert(wikiLog).values({ actor: "agent", action: "repo.synced", repoId: repo.id, details: { indexed: 3 } });

    const o = await getJobsOverview(db);

    expect(o.repos).toEqual([expect.objectContaining({ fullName: "acme/widgets", status: "syncing" })]);
    expect(o.runs.map((r) => [r.kind, r.status, r.costUsd, r.finishedAt])).toEqual([
      ["chat", "running", 0.01, null],
      ["author", "succeeded", 0.25, "2026-01-01T00:05:00.000Z"],
    ]);
    expect(o.activity).toEqual([expect.objectContaining({ action: "repo.synced", repo: "acme/widgets", details: { indexed: 3 } })]);
    expect(o.totalCostUsd).toBeCloseTo(0.26);
    expect(Array.isArray(o.jobs)).toBe(true);
    // The route returns this as JSON and the client parses it with the schema: the round trip must hold.
    expect(jobsOverviewSchema.safeParse(JSON.parse(JSON.stringify(o))).success).toBe(true);
  });

  it("is empty, not an error, on a fresh database", async () => {
    const o = await getJobsOverview(db);
    expect(o).toMatchObject({ repos: [], runs: [], activity: [], totalCostUsd: 0 });
  });
});
