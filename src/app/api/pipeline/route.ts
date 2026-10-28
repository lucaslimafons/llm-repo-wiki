import { connection } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { getRepoTimeline } from "@/jobs/timeline";
import { describeIssues } from "@/lib/zod-issues";

const querySchema = z.object({
  repo: z.string().max(64).optional(),
  run: z.string().max(64).optional(),
});

/** One repo's runs and the selected run's events, for /pipeline (polled while live). */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: describeIssues(parsed.error) }, { status: 400 });
  return Response.json(await getRepoTimeline(db(), { repoId: parsed.data.repo, run: parsed.data.run }));
}
