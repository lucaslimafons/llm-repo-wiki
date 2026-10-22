"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { AlertTriangle, RotateCcw, SendHorizontal, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { WRITE_TOOL_NAMES } from "@/agent/tool-names";
import type { WikiUIMessage } from "@/agent/tools";
import { Markdown } from "@/components/markdown/Markdown";
import { queryKeys } from "@/lib/query-keys";
import { chatApi } from "./api";
import { SourcesList } from "./SourcesList";
import { ToolActivity } from "./ToolActivity";
import { needsApproval, ToolPart } from "./ToolPart";

const WRITES = new Set<string>(WRITE_TOOL_NAMES);

// Only the newest message goes up: the server owns the history (and the approvals in it).
const transport = new DefaultChatTransport<WikiUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, message: messages.at(-1) } }),
});

function wroteWiki(message: WikiUIMessage) {
  return message.parts.some((p) => isToolUIPart(p) && WRITES.has(getToolName(p)) && p.state === "output-available");
}

function Message({ message, onRespond }: { message: WikiUIMessage; onRespond: (id: string, approved: boolean) => void }) {
  if (message.role === "user") {
    return (
      <div className="ml-6 self-end whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2 text-sm">
        {message.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
      </div>
    );
  }
  const sources = message.parts.filter((p) => p.type === "source-url");
  const activity = message.parts.filter(isToolUIPart).filter((p) => !needsApproval(p));
  return (
    <div className="min-w-0 text-sm">
      <ToolActivity parts={activity} onRespond={onRespond} />
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={i} className="min-w-0 break-words [&_pre]:overflow-x-auto">
              <Markdown>{part.text}</Markdown>
            </div>
          );
        }
        // Only approval cards render in place: everything else lives in the activity group above.
        if (isToolUIPart(part) && needsApproval(part)) return <ToolPart key={part.toolCallId} part={part} onRespond={onRespond} />;
        return null;
      })}
      <SourcesList sources={sources} />
    </div>
  );
}

export function ChatThread({ chatId, initialMessages }: { chatId: string; initialMessages: WikiUIMessage[] }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop, regenerate, addToolApprovalResponse, clearError } = useChat<WikiUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.list() });
      if (wroteWiki(message)) void queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
    },
  });
  const busy = status === "submitted" || status === "streaming";

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (error) clearError();
    void sendMessage({ text });
    setInput("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* column-reverse keeps the view pinned to the newest message without a scroll effect */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-2">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">Ask about the code, or ask me to edit the wiki.</p>
          )}
          {messages.map((m) => (
            <Message key={m.id} message={m} onRespond={(id, approved) => void addToolApprovalResponse({ id, approved })} />
          ))}
          {status === "submitted" && <p className="text-xs text-muted">Thinking…</p>}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-line p-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error.message}</span>
              <button type="button" onClick={() => void regenerate()} className="flex shrink-0 items-center gap-1 text-foreground">
                <RotateCcw className="size-3.5" /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-line p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Message the wiki agent…"
          className="min-h-0 flex-1 resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        {busy ? (
          <button type="button" onClick={() => void Promise.all([chatApi.stop(chatId), stop()])} title="Stop" className="rounded-md border border-line p-2">
            <Square className="size-4" />
          </button>
        ) : (
          <button type="submit" title="Send" disabled={!input.trim()} className="rounded-md bg-accent p-2 text-accent-foreground disabled:opacity-50">
            <SendHorizontal className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}
