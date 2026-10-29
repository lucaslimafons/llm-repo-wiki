import { z } from "zod";
import { stopRun } from "@/agent/active-runs";

/** The Stop button: cancels the model server-side. What streamed so far is still saved. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid chat id" }, { status: 400 });
  return new Response(null, { status: stopRun(id.data) ? 204 : 404 });
}
