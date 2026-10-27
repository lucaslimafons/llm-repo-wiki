/** Production wiring shared by the web app and the worker. Keep code-chunk (WASM) out of here. */
import { db } from "@/db/client";
import { createOwnerRoutedClient, type GitHubClient } from "@/github/client";
import { tokenForOwner } from "@/github/tokens";
import { enqueueRepoSync } from "@/jobs/queue";
import { env, openRouterKey } from "@/lib/env";
import { createOpenRouterEmbedder, type Embedder } from "./embedder";
import type { RepoDeps } from "./repos";
import { providerPrivacy } from "@/lib/openrouter-privacy";

let github: GitHubClient | undefined;
let embedder: Embedder | undefined;

export function prodGitHub(): GitHubClient {
  const { GITHUB_TOKENS, GITHUB_TOKEN } = env();
  github ??= createOwnerRoutedClient((owner) => tokenForOwner(GITHUB_TOKENS, GITHUB_TOKEN, owner));
  return github;
}

export function prodEmbedder(): Embedder {
  embedder ??= createOpenRouterEmbedder({ apiKey: openRouterKey(), model: env().EMBEDDING_MODEL, ...providerPrivacy() });
  return embedder;
}

export function prodRepoDeps(): RepoDeps {
  return { db: db(), github: prodGitHub(), enqueueSync: enqueueRepoSync };
}
