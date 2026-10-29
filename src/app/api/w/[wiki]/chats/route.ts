import { connection } from "next/server";
import { createChat, listChats } from "@/agent/chat-store";
import { db } from "@/db/client";
import { routeWiki } from "@/wikis/route";

type Ctx = RouteContext<"/api/w/[wiki]/chats">;

export async function GET(_req: Request, ctx: Ctx) {
  await connection();
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  return Response.json(await listChats(db(), wiki.id));
}

export async function POST(_req: Request, ctx: Ctx) {
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  return Response.json(await createChat(db(), wiki.id), { status: 201 });
}
