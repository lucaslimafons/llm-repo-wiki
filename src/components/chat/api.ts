import type { ChatSummary } from "@/agent/chat-store";
import type { WikiUIMessage } from "@/agent/tools";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const chatApi = {
  list: () => fetch("/api/chats").then((r) => json<ChatSummary[]>(r)),
  create: () => fetch("/api/chats", { method: "POST" }).then((r) => json<ChatSummary>(r)),
  remove: async (id: string) => {
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
  },
  messages: (id: string) =>
    fetch(`/api/chats/${id}`).then((r) => json<{ id: string; title: string | null; messages: WikiUIMessage[] }>(r)),
  /** 404 just means the run already ended. */
  stop: (id: string) => fetch(`/api/chats/${id}/stop`, { method: "POST" }).then(() => undefined),
  pageBody: (path: string) =>
    fetch(`/api/chat/page?${new URLSearchParams({ path })}`).then((r) => json<{ path: string; bodyMd: string; revisionId: string | null }>(r)),
};
