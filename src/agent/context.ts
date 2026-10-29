import { generateText, getToolName, isToolUIPart, type LanguageModel, type UIMessage } from "ai";
import type { Db } from "@/db/client";
import { setSummary } from "./chat-store";
import { SUMMARY_INSTRUCTIONS } from "./prompts";
import { modelName } from "./models";
import { startAgentRun } from "./runs";

/** Above this many (estimated) tokens of verbatim history, the oldest turns fold into the summary. */
export const CONTEXT_BUDGET_TOKENS = 60_000;
/** How much recent history stays verbatim after a fold. */
export const KEEP_RECENT_TOKENS = 20_000;

/** ~4 characters per token over the stored JSON, tool outputs included. Cheap and conservative. */
export function estimateTokens(messages: UIMessage[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(JSON.stringify(m.parts).length / 4), 0);
}

/** The messages the model still sees verbatim: everything after the last folded one. */
export function activeMessages(messages: UIMessage[], summarizedThroughId: string | null): UIMessage[] {
  if (!summarizedThroughId) return messages;
  const i = messages.findIndex((m) => m.id === summarizedThroughId);
  return i === -1 ? messages : messages.slice(i + 1);
}

/**
 * Index in `active` where the verbatim tail starts: always a user message, so a tool call is never
 * separated from its result or approval. The newest user turn is kept even if it alone is over.
 */
export function foldBoundary(active: UIMessage[], keepTokens = KEEP_RECENT_TOKENS): number {
  let boundary = -1;
  let tokens = 0;
  for (let i = active.length - 1; i >= 0; i--) {
    tokens += estimateTokens([active[i]]);
    if (active[i].role !== "user") continue;
    if (boundary !== -1 && tokens > keepTokens) break;
    boundary = i;
  }
  return Math.max(boundary, 0);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function transcript(messages: UIMessage[]): string {
  return messages
    .map((m) => {
      const lines = m.parts.flatMap((part) => {
        if (part.type === "text") return [part.text];
        if (part.type === "source-url") return [`(source: ${part.title ?? part.url})`];
        if (isToolUIPart(part)) {
          const output = "output" in part && part.output !== undefined ? ` → ${clip(JSON.stringify(part.output), 400)}` : "";
          return [`[tool ${getToolName(part)} ${clip(JSON.stringify(part.input ?? {}), 300)} (${part.state})${output}]`];
        }
        return [];
      });
      return `${m.role.toUpperCase()}: ${lines.join("\n")}`;
    })
    .join("\n\n");
}

export type ContextResult = { summary: string | null; active: UIMessage[]; folded: boolean };

/**
 * Folds the oldest verbatim turns into chats.summary once they exceed the budget, so a long session
 * keeps working without ever depending on what the browser holds.
 */
export async function buildContext(input: {
  db: Db;
  wikiId: string;
  chatId: string;
  messages: UIMessage[];
  summary: string | null;
  summarizedThroughId: string | null;
  summaryModel: LanguageModel;
  budgetTokens?: number;
  keepTokens?: number;
}): Promise<ContextResult> {
  const budget = input.budgetTokens ?? CONTEXT_BUDGET_TOKENS;
  const active = activeMessages(input.messages, input.summarizedThroughId);
  if (estimateTokens(active) <= budget) return { summary: input.summary, active, folded: false };

  const boundary = foldBoundary(active, input.keepTokens ?? Math.min(KEEP_RECENT_TOKENS, Math.floor(budget / 3)));
  if (boundary === 0) return { summary: input.summary, active, folded: false };
  const toFold = active.slice(0, boundary);

  const run = await startAgentRun(input.db, { wikiId: input.wikiId, kind: "chat", model: modelName(input.summaryModel) });
  try {
    const result = await generateText({
      model: input.summaryModel,
      instructions: SUMMARY_INSTRUCTIONS,
      prompt: [
        input.summary ? `Summary so far:\n${input.summary}` : "There is no summary yet.",
        `Conversation to fold in:\n${transcript(toFold)}`,
      ].join("\n\n"),
      maxOutputTokens: 1_200,
      onStepEnd: (step) => run.addStep(step),
    });
    await run.finish({ status: "succeeded" });
    const summary = result.text.trim();
    await setSummary(input.db, input.chatId, summary, toFold.at(-1)!.id);
    return { summary, active: active.slice(boundary), folded: true };
  } catch (error) {
    await run.finish({ status: "failed", error });
    throw error;
  }
}
