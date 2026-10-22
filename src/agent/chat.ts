import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  ToolLoopAgent,
  toUIMessageStream,
  validateUIMessages,
  type LanguageModel,
  type StreamTextTransform,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { SearchHit, SearchInput, WikiStore } from "@/core/contracts";
import type { Db } from "@/db/client";
import {
  ChatRequestError,
  getChat,
  loadMessages,
  mergeIncomingMessage,
  saveMessages,
  truncateAfter,
} from "./chat-store";
import { buildContext } from "./context";
import { modelName } from "./models";
import { buildChatInstructions, loadWikiSchema } from "./prompts";
import { startAgentRun } from "./runs";
import { dedupeSources } from "./sources";
import { createWikiTools, WIKI_TOOL_APPROVAL, type SearchToolOutput, type WikiTools } from "./tools";

export const CHAT_MAX_STEPS = 8;

export type ChatDeps = {
  db: Db;
  store: WikiStore;
  search: (input: SearchInput) => Promise<SearchHit[]>;
  model: LanguageModel;
  /** Cheap model for folding old turns into the summary. */
  summaryModel: LanguageModel;
  approvalSecret: Uint8Array;
  loadSchema?: () => Promise<string>;
  budgetTokens?: number;
};

export const chatRequestSchema = z.object({ id: z.uuid(), message: z.unknown() });

/**
 * Every searchKnowledge hit becomes a `source` stream part right after its tool result, so
 * toUIMessageStream (sendSources) puts it on the assistant message and it persists with it.
 */
export function sourcesTransform(seen: Set<string>): StreamTextTransform<WikiTools> {
  return () =>
    new TransformStream({
      transform(part, controller) {
        controller.enqueue(part);
        if (part.type !== "tool-result" || part.toolName !== "searchKnowledge" || part.dynamic) return;
        const output = part.output as SearchToolOutput;
        for (const s of dedupeSources(output.hits.map((h) => h.source), seen)) {
          controller.enqueue({ type: "source", sourceType: "url", id: s.sourceId, url: s.url, title: s.title });
        }
      },
    });
}

function existingSourceIds(message: UIMessage | undefined): Set<string> {
  return new Set(
    message?.role === "assistant"
      ? message.parts.flatMap((p) => (p.type === "source-url" ? [p.sourceId] : []))
      : [],
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * POST /api/chat. The client sends only its newest message; history, summary and approvals come
 * from Postgres, so reopening a session (or another tab) gives the agent the same context.
 */
export async function handleChatRequest(deps: ChatDeps, body: unknown): Promise<Response> {
  const { db, store } = deps;
  const req = chatRequestSchema.safeParse(body);
  if (!req.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const chatId = req.data.id;
  const chat = await getChat(db, chatId);
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });

  let merged;
  try {
    merged = mergeIncomingMessage(await loadMessages(db, chatId), req.data.message);
  } catch (error) {
    if (error instanceof ChatRequestError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const run = await startAgentRun(db, { kind: "chat", model: modelName(deps.model) });
  const tools = createWikiTools({ store, search: deps.search, author: { kind: "agent", agentRunId: run.id }, mode: "apply" });

  try {
    const messages = await validateUIMessages<UIMessage>({ messages: merged.messages, tools });
    if (merged.truncateAfterId) await truncateAfter(db, chatId, merged.truncateAfterId);
    await saveMessages(db, chatId, merged.dirty);

    const [context, schema, tree] = await Promise.all([
      buildContext({
        db,
        chatId,
        messages,
        summary: chat.summary,
        summarizedThroughId: chat.summarizedThroughMessageId,
        summaryModel: deps.summaryModel,
        budgetTokens: deps.budgetTokens,
      }),
      (deps.loadSchema ?? loadWikiSchema)(),
      store.listTree(),
    ]);

    const agent = new ToolLoopAgent({
      model: deps.model,
      instructions: buildChatInstructions({ schema, tree, summary: context.summary }),
      tools,
      stopWhen: isStepCount(CHAT_MAX_STEPS),
      toolApproval: WIKI_TOOL_APPROVAL,
      experimental_toolApprovalSecret: deps.approvalSecret,
      onStepEnd: (step) => run.addStep(step),
    });

    // No abortSignal from the request: a closed tab must not cut the run short (consumeStream below).
    const result = await agent.stream({
      messages: await convertToModelMessages(context.active, { tools }),
      experimental_transform: sourcesTransform(existingSourceIds(messages.at(-1))),
    });

    const stream = toUIMessageStream({
      stream: result.stream,
      tools,
      sendSources: true,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onError: errorText,
      onStepEnd: ({ responseMessage }) => saveMessages(db, chatId, [responseMessage]),
      onEnd: async ({ responseMessage, outcome }) => {
        await saveMessages(db, chatId, [responseMessage]);
        await run.finish(
          outcome.status === "failed" ? { status: "failed", error: outcome.error } : { status: "succeeded" },
        );
      },
    });
    return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
  } catch (error) {
    await run.finish({ status: "failed", error });
    throw error;
  }
}
