import { z } from "zod";
import { chatMessagesSchema, chatSummarySchema, pageBodySchema } from "@/core/api-schemas";
import { fetchJson } from "@/lib/fetch-json";

export const chatApi = {
  list: () => fetchJson("/api/chats", z.array(chatSummarySchema)),
  create: () => fetchJson("/api/chats", chatSummarySchema, { method: "POST" }),
  remove: async (id: string) => {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
  },
  messages: (id: string) => fetchJson(`/api/chats/${encodeURIComponent(id)}`, chatMessagesSchema),
  /** 404 just means the run already ended. */
  stop: (id: string) => fetch(`/api/chats/${encodeURIComponent(id)}/stop`, { method: "POST" }).then(() => undefined),
  pageBody: (path: string) => fetchJson(`/api/chat/page?${new URLSearchParams({ path })}`, pageBodySchema),
};
