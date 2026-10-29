import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import type { Db } from "@/db/client";
import { chatMessages, chats } from "@/db/schema";

export type ChatSummary = { id: string; title: string | null; createdAt: string; updatedAt: string };

export class ChatRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TITLE_MAX = 60;

function toSummary(row: typeof chats.$inferSelect): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createChat(db: Db, wikiId: string): Promise<ChatSummary> {
  const [row] = await db.insert(chats).values({ wikiId }).returning();
  return toSummary(row);
}

export async function listChats(db: Db, wikiId: string, limit = 100): Promise<ChatSummary[]> {
  const rows = await db.select().from(chats).where(eq(chats.wikiId, wikiId)).orderBy(desc(chats.updatedAt)).limit(limit);
  return rows.map(toSummary);
}

/** Ids arrive from the client: a chat of another wiki reads as not found. */
export async function getChat(db: Db, wikiId: string, id: string) {
  const [row] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.wikiId, wikiId)));
  return row ?? null;
}

export async function deleteChat(db: Db, wikiId: string, id: string): Promise<boolean> {
  const rows = await db.delete(chats).where(and(eq(chats.id, id), eq(chats.wikiId, wikiId))).returning({ id: chats.id });
  return rows.length > 0;
}

/** Ordered by created_at, which saveMessages keeps strictly increasing per chat (see below). */
export async function loadMessages<M extends UIMessage = UIMessage>(db: Db, chatId: string): Promise<M[]> {
  const rows = await db
    .select({ message: chatMessages.message })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));
  return rows.map((r) => r.message as M);
}

export function titleFrom(message: UIMessage): string | null {
  const text = message.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1).trimEnd()}…` : text;
}

/**
 * Upserts whole UIMessages. chat_messages has no ordinal column, so new rows get created_at
 * strictly after the chat's latest row: rows saved in one statement would otherwise tie and reload
 * out of order. Also bumps updated_at and sets the title from the first user message.
 */
export async function saveMessages(db: Db, chatId: string, messages: UIMessage[]): Promise<void> {
  if (messages.length === 0) return;
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), inArray(chatMessages.id, messages.map((m) => m.id))));
    const known = new Set(existing.map((r) => r.id));
    const [{ last }] = await tx
      .select({ last: sql<string | null>`max(${chatMessages.createdAt})` })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));
    let at = Math.max(Date.now(), last ? new Date(last).getTime() + 1 : 0);

    for (const m of messages) {
      if (known.has(m.id)) {
        await tx
          .update(chatMessages)
          .set({ message: m })
          .where(and(eq(chatMessages.id, m.id), eq(chatMessages.chatId, chatId)));
      } else {
        await tx.insert(chatMessages).values({ id: m.id, chatId, role: m.role, message: m, createdAt: new Date(at++) });
      }
    }

    const [chat] = await tx.select({ title: chats.title }).from(chats).where(eq(chats.id, chatId));
    const firstUser = chat?.title ? null : messages.find((m) => m.role === "user");
    await tx
      .update(chats)
      .set({ updatedAt: new Date(), ...(firstUser ? { title: titleFrom(firstUser) } : {}) })
      .where(eq(chats.id, chatId));
  });
}

/** Removes every message after `messageId` (a regenerate from that user turn). */
export async function truncateAfter(db: Db, chatId: string, messageId: string): Promise<void> {
  const [row] = await db
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, messageId)));
  if (!row) return;
  await db.delete(chatMessages).where(and(eq(chatMessages.chatId, chatId), gt(chatMessages.createdAt, row.createdAt)));
}

export async function setSummary(db: Db, chatId: string, summary: string, throughMessageId: string) {
  await db
    .update(chats)
    .set({ summary, summarizedThroughMessageId: throughMessageId })
    .where(eq(chats.id, chatId));
}

// ── Merging the one message the client sends into the stored history ──────

const messageIdSchema = z.string().min(1).max(100).regex(/^[\w-]+$/);

const incomingSchema = z.object({
  id: messageIdSchema,
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.string(), z.unknown())).max(200),
});

const userTextSchema = z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(20_000) });

export type MergeResult = {
  messages: UIMessage[];
  /** Messages created or changed by this request; persisted before the model runs. */
  dirty: UIMessage[];
  /** A user turn the client already sent (a retry/regenerate): later messages must be dropped. */
  truncateAfterId?: string;
};

function denyPendingApprovals(message: UIMessage): UIMessage | null {
  let changed = false;
  const parts = message.parts.map((part) => {
    if (!isToolUIPart(part) || part.state !== "approval-requested") return part;
    changed = true;
    return {
      ...part,
      state: "approval-responded" as const,
      approval: { ...part.approval, approved: false, reason: "The user sent a new message instead of approving." },
    };
  });
  return changed ? ({ ...message, parts } as UIMessage) : null;
}

/**
 * The server's history is the truth. A user turn is appended as plain text; an assistant message
 * is accepted ONLY as approve/deny decisions applied to the stored message, so a client can never
 * rewrite tool inputs, outputs or earlier turns.
 */
export function mergeIncomingMessage(stored: UIMessage[], raw: unknown): MergeResult {
  const parsed = incomingSchema.safeParse(raw);
  if (!parsed.success) throw new ChatRequestError(400, `invalid message: ${parsed.error.issues[0]?.message}`);
  const incoming = parsed.data;
  const last = stored.at(-1);

  if (incoming.role === "user") {
    const parts = z.array(userTextSchema).min(1).safeParse(incoming.parts.filter((p) => p.type === "text"));
    if (!parsed.success || !parts.success) throw new ChatRequestError(400, "a user message must contain text");
    const index = stored.findIndex((m) => m.id === incoming.id);
    if (index !== -1) {
      if (stored[index].role !== "user") throw new ChatRequestError(409, "message id already used");
      return { messages: stored.slice(0, index + 1), dirty: [], truncateAfterId: incoming.id };
    }
    const message: UIMessage = { id: incoming.id, role: "user", parts: parts.data.map((p) => ({ type: "text", text: p.text })) };
    const denied = last && last.role === "assistant" ? denyPendingApprovals(last) : null;
    const history = denied ? [...stored.slice(0, -1), denied] : stored;
    return { messages: [...history, message], dirty: [...(denied ? [denied] : []), message] };
  }

  if (!last || last.role !== "assistant" || last.id !== incoming.id) {
    throw new ChatRequestError(409, "only the latest assistant message can be answered");
  }
  const decisions = new Map<string, { approved: boolean; reason?: string }>();
  for (const part of incoming.parts) {
    const approval = part.approval as { id?: unknown; approved?: unknown; reason?: unknown } | undefined;
    if (part.state !== "approval-responded" || typeof approval?.id !== "string" || typeof approval.approved !== "boolean") continue;
    decisions.set(approval.id, {
      approved: approval.approved,
      reason: typeof approval.reason === "string" ? approval.reason.slice(0, 500) : undefined,
    });
  }
  let applied = 0;
  const parts = last.parts.map((part) => {
    if (!isToolUIPart(part) || part.state !== "approval-requested") return part;
    const decision = decisions.get(part.approval.id);
    if (!decision) return part;
    applied++;
    return {
      ...part,
      state: "approval-responded" as const,
      approval: { ...part.approval, approved: decision.approved, ...(decision.reason ? { reason: decision.reason } : {}) },
    };
  });
  if (applied === 0) throw new ChatRequestError(400, "no pending approval was answered");
  const merged = { ...last, parts } as UIMessage;
  return { messages: [...stored.slice(0, -1), merged], dirty: [merged] };
}
