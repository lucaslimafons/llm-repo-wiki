import { env } from "@/lib/env";

/**
 * Per-request routing to zero-data-retention endpoints that don't collect prompts. Enforced in the
 * request, not only in the OpenRouter dashboard, so a changed account setting or a model with no
 * ZDR endpoint fails the call instead of sending private code to a provider that keeps it.
 */
export function providerPrivacy(): { provider?: { zdr: true; data_collection: "deny" } } {
  return env().OPENROUTER_ZDR ? { provider: { zdr: true, data_collection: "deny" } } : {};
}
