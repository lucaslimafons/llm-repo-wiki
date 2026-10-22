import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

type StreamPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolName: string; input: unknown; toolCallId?: string };

export const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

let callSeq = 0;

/** One model turn: text and/or tool calls, then a finish carrying OpenRouter-style cost metadata. */
export function turn(parts: StreamPart[], opts: { input?: number; output?: number; cost?: number } = {}) {
  const chunks: unknown[] = [];
  let hasToolCall = false;
  parts.forEach((p, i) => {
    if (p.type === "text") {
      chunks.push({ type: "text-start", id: `t${i}` }, { type: "text-delta", id: `t${i}`, delta: p.text }, { type: "text-end", id: `t${i}` });
    } else {
      hasToolCall = true;
      chunks.push({
        type: "tool-call",
        toolCallId: p.toolCallId ?? `call-${++callSeq}`,
        toolName: p.toolName,
        input: JSON.stringify(p.input),
      });
    }
  });
  chunks.push({
    type: "finish",
    finishReason: { unified: hasToolCall ? "tool-calls" : "stop", raw: undefined },
    usage: usage(opts.input ?? 10, opts.output ?? 5),
    providerMetadata: { openrouter: { usage: { cost: opts.cost ?? 0.001 } } },
  });
  return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
}

/** A streaming mock that plays `turns` in order (the last one repeats). */
export function mockStreamModel(turns: ReturnType<typeof turn>[]) {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: "mock-chat",
    doStream: async () => turns[Math.min(i++, turns.length - 1)],
  });
}

/** A generate-mode mock (generateText / agent.generate), with the same per-call cost metadata. */
export function mockGenerateModel(results: Array<{ text?: string; toolCalls?: { toolName: string; input: unknown }[]; cost?: number; input?: number; output?: number }>) {
  let i = 0;
  return new MockLanguageModelV4({
    modelId: "mock-author",
    doGenerate: async () => {
      const r = results[Math.min(i++, results.length - 1)];
      const content = [
        ...(r.text !== undefined ? [{ type: "text" as const, text: r.text }] : []),
        ...(r.toolCalls ?? []).map((c) => ({ type: "tool-call" as const, toolCallId: `call-${++callSeq}`, toolName: c.toolName, input: JSON.stringify(c.input) })),
      ];
      return {
        content,
        finishReason: { unified: r.toolCalls?.length ? ("tool-calls" as const) : ("stop" as const), raw: undefined },
        usage: usage(r.input ?? 100, r.output ?? 50),
        providerMetadata: { openrouter: { usage: { cost: r.cost ?? 0.002 } } },
        warnings: [],
      };
    },
  });
}
