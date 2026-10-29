import { z } from "zod";
import { chatMessagesSchema, chatSummarySchema, pageBodySchema } from "@/core/api-schemas";
import { fetchJson } from "@/lib/fetch-json";
import { apiBase } from "@/wiki/routes";

const chatUrl = (slug: string, id: string) => `${apiBase(slug)}/chats/${encodeURIComponent(id)}`;

/** Every call is scoped to one wiki: the slug comes first. */
export const chatApi = {
  list: (slug: string) => fetchJson(`${apiBase(slug)}/chats`, z.array(chatSummarySchema)),
  create: (slug: string) => fetchJson(`${apiBase(slug)}/chats`, chatSummarySchema, { method: "POST" }),
  remove: async (slug: string, id: string) => {
    const res = await fetch(chatUrl(slug, id), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
  },
  messages: (slug: string, id: string) => fetchJson(chatUrl(slug, id), chatMessagesSchema),
  /** 404 just means the run already ended. */
  stop: (slug: string, id: string) => fetch(`${chatUrl(slug, id)}/stop`, { method: "POST" }).then(() => undefined),
  pageBody: (slug: string, path: string) => fetchJson(`${apiBase(slug)}/chat/page?${new URLSearchParams({ path })}`, pageBodySchema),
};
