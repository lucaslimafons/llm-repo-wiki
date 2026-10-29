import { z } from "zod";
import { stopRun } from "@/agent/active-runs";
import { getChat } from "@/agent/chat-store";
import { db } from "@/db/client";
import { routeWiki } from "@/wikis/route";

/** The Stop button: cancels the model server-side. What streamed so far is still saved. */
export async function POST(_req: Request, ctx: RouteContext<"/api/w/[wiki]/chats/[id]/stop">) {
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid chat id" }, { status: 400 });
  // Only a chat of this wiki can be stopped from its URL.
  if (!(await getChat(db(), wiki.id, id.data))) return new Response(null, { status: 404 });
  return new Response(null, { status: stopRun(id.data) ? 204 : 404 });
}
