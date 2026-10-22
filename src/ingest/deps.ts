/** Production wiring shared by the web app and the worker. Keep code-chunk (WASM) out of here. */
import { db } from "@/db/client";
import { createGitHubClient, type GitHubClient } from "@/github/client";
import { enqueueRepoSync } from "@/jobs/queue";
import { env, openRouterKey } from "@/lib/env";
import { createOpenRouterEmbedder, type Embedder } from "./embedder";
import type { RepoDeps } from "./repos";

let github: GitHubClient | undefined;
let embedder: Embedder | undefined;

export function prodGitHub(): GitHubClient {
  github ??= createGitHubClient({ token: env().GITHUB_TOKEN });
  return github;
}

export function prodEmbedder(): Embedder {
  embedder ??= createOpenRouterEmbedder({ apiKey: openRouterKey(), model: env().EMBEDDING_MODEL });
  return embedder;
}

export function prodRepoDeps(): RepoDeps {
  return { db: db(), github: prodGitHub(), enqueueSync: enqueueRepoSync };
}
