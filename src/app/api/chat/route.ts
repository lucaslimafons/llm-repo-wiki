import { handleChatRequest } from "@/agent/chat";
import { chatDeps } from "@/agent/server";

/** Body: { id: chatId, message: newest UIMessage }. The history is loaded server-side. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handleChatRequest(chatDeps(), body);
}
