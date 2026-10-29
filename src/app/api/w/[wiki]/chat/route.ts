import { handleChatRequest } from "@/agent/chat";
import { chatDeps } from "@/agent/server";
import { routeWiki } from "@/wikis/route";

/** Body: { id: chatId, message: newest UIMessage }. The history is loaded server-side. */
export async function POST(req: Request, ctx: RouteContext<"/api/w/[wiki]/chat">) {
  const wiki = await routeWiki(ctx.params);
  if (wiki instanceof Response) return wiki;
  const body = await req.json().catch(() => null);
  return handleChatRequest(chatDeps(wiki), body);
}
