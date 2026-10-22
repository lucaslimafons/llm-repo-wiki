"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { queryKeys } from "@/lib/query-keys";
import { chatApi } from "./api";
import { ChatThread } from "./ChatThread";

/** Loads a session's stored history fresh on every open, then hands it to useChat. */
function ChatSession({ chatId }: { chatId: string }) {
  const history = useQuery({
    queryKey: queryKeys.chat.messages(chatId),
    queryFn: () => chatApi.messages(chatId),
    // Never seed useChat from a cached copy: the server may have newer turns (another tab, a reload).
    staleTime: 0,
    gcTime: 0,
  });
  if (history.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (history.isError) return <p className="p-3 text-sm text-danger">Couldn&apos;t load this chat: {history.error.message}</p>;
  return <ChatThread chatId={chatId} initialMessages={history.data.messages} />;
}

export function ChatPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const chats = useQuery({ queryKey: queryKeys.chat.list(), queryFn: chatApi.list });

  const create = useMutation({
    mutationFn: chatApi.create,
    onSuccess: (chat) => {
      setSelected(chat.id);
      return queryClient.invalidateQueries({ queryKey: queryKeys.chat.list() });
    },
  });
  const remove = useMutation({
    mutationFn: chatApi.remove,
    onSuccess: () => {
      setSelected(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.chat.list() });
    },
  });

  const list = chats.data ?? [];
  // A deleted or unknown selection falls back to the most recent session.
  const activeId = list.some((c) => c.id === selected) ? selected : (list[0]?.id ?? null);
  const mutationError = create.error ?? remove.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1.5 border-b border-line p-2">
        <select
          value={activeId ?? ""}
          onChange={(e) => setSelected(e.target.value)}
          disabled={list.length === 0}
          aria-label="Chat session"
          className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          {list.length === 0 && <option value="">No chats yet</option>}
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title ?? "New chat"}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="New chat"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="rounded-md border border-line p-1.5 disabled:opacity-50"
        >
          <MessageSquarePlus className="size-4" />
        </button>
        <button
          type="button"
          title="Delete chat"
          onClick={() => activeId && remove.mutate(activeId)}
          disabled={!activeId || remove.isPending}
          className="rounded-md border border-line p-1.5 text-danger disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
      </header>
      {mutationError && <p className="px-3 py-1 text-xs text-danger">{mutationError.message}</p>}
      {chats.isError ? (
        <p className="p-3 text-sm text-danger">Couldn&apos;t load chats: {chats.error.message}</p>
      ) : chats.isPending ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : activeId ? (
        <ChatSession key={activeId} chatId={activeId} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted">
          <p>Chat with the wiki agent.</p>
          <button
            type="button"
            onClick={() => create.mutate()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-accent-foreground"
          >
            <MessageSquarePlus className="size-4" /> New chat
          </button>
        </div>
      )}
    </div>
  );
}
