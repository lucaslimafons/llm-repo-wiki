import { eq, sql } from "drizzle-orm";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";

export type AgentRunKind = "chat" | "author" | "lint";
export type StepUsage = { usage: LanguageModelUsage; providerMetadata: ProviderMetadata | undefined };

/** OpenRouter usage accounting: providerMetadata.openrouter.usage.cost (USD). Absent → 0. */
export function stepCost(providerMetadata: ProviderMetadata | undefined): number {
  const usage = providerMetadata?.openrouter?.usage as { cost?: unknown } | undefined;
  return typeof usage?.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : 0;
}

export type AgentRun = {
  id: string;
  /** Adds one step's tokens and cost. Increments in SQL, so concurrent steps never lose an update. */
  addStep(step: StepUsage): Promise<void>;
  totals(): { inputTokens: number; outputTokens: number; costUsd: number };
  finish(result: { status: "succeeded" | "failed" | "budget_exceeded" | "stopped"; error?: unknown }): Promise<void>;
};

export async function startAgentRun(db: Db, input: { wikiId: string; kind: AgentRunKind; model: string }): Promise<AgentRun> {
  const [row] = await db.insert(agentRuns).values(input).returning({ id: agentRuns.id });
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let finished = false;

  return {
    id: row.id,
    totals: () => ({ ...totals }),
    async addStep({ usage, providerMetadata }) {
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const cost = stepCost(providerMetadata);
      totals.inputTokens += inputTokens;
      totals.outputTokens += outputTokens;
      totals.costUsd += cost;
      await db
        .update(agentRuns)
        .set({
          inputTokens: sql`${agentRuns.inputTokens} + ${inputTokens}`,
          outputTokens: sql`${agentRuns.outputTokens} + ${outputTokens}`,
          costUsd: sql`${agentRuns.costUsd} + ${cost.toFixed(6)}::numeric`,
        })
        .where(eq(agentRuns.id, row.id));
    },
    async finish({ status, error }) {
      if (finished) return;
      finished = true;
      const message = error === undefined ? null : error instanceof Error ? error.message : String(error);
      await db
        .update(agentRuns)
        .set({ status, error: message?.slice(0, 2_000) ?? null, finishedAt: new Date() })
        .where(eq(agentRuns.id, row.id));
    },
  };
}
