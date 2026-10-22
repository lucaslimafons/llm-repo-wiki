import { hkdfSync } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { env, openRouterKey } from "@/lib/env";

let provider: ReturnType<typeof createOpenRouter> | undefined;

function openrouter() {
  provider ??= createOpenRouter({ apiKey: openRouterKey() });
  return provider;
}

/** usage.include makes OpenRouter return cost in providerMetadata.openrouter.usage, which agent_runs records. */
const accounting = { usage: { include: true } } as const;

export function chatModel(): LanguageModel {
  return openrouter().chat(env().CHAT_MODEL, accounting);
}

export function authorModel(): LanguageModel {
  return openrouter().chat(env().AUTHOR_MODEL, accounting);
}

/** The id recorded in agent_runs.model for any model instance (real or mock). */
export function modelName(model: LanguageModel): string {
  return typeof model === "string" ? model : `${model.provider}:${model.modelId}`;
}

let approvalSecret: Uint8Array | undefined;

/**
 * Signs tool approvals so a forged "approved" can't run a destructive tool. Derived from the
 * OpenRouter key (HKDF) rather than a new env var a setup could forget.
 */
export function toolApprovalSecret(): Uint8Array {
  approvalSecret ??= new Uint8Array(
    hkdfSync("sha256", openRouterKey(), "llm-repo-wiki", "tool-approval-v1", 32),
  );
  return approvalSecret;
}
