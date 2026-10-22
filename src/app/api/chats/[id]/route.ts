import { connection } from "next/server";
import { z } from "zod";
import { deleteChat, getChat, loadMessages } from "@/agent/chat-store";
import { db } from "@/db/client";

type Ctx = { params: Promise<{ id: string }> };
const idSchema = z.uuid();

/** A session's full stored history, exactly as the agent will see it on the next turn. */
export async function GET(_req: Request, ctx: Ctx) {
  await connection();
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid chat id" }, { status: 400 });
  const chat = await getChat(db(), id.data);
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  return Response.json({ id: chat.id, title: chat.title, messages: await loadMessages(db(), chat.id) });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return Response.json({ error: "invalid chat id" }, { status: 400 });
  const deleted = await deleteChat(db(), id.data);
  return deleted ? new Response(null, { status: 204 }) : Response.json({ error: "chat not found" }, { status: 404 });
}
