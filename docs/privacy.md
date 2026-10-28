# Privacy: what leaves your machine

Code goes to model providers through OpenRouter. Part of protecting it is enforced by the app, and
part **can only be set in your OpenRouter account**.

## What is sent, and where

| Data | Goes to | Default model |
|---|---|---|
| Chunks of every indexed file, for embeddings | OpenRouter → OpenAI model on Azure | `openai/text-embedding-3-small` |
| Retrieved chunks, for page writing and chat | OpenRouter → Claude on Vertex or Bedrock | `anthropic/claude-haiku-5.5` |
| A search query from the MCP server | OpenRouter, to embed the query only | `openai/text-embedding-3-small` |
| Your GitHub token, files the secret scanner flags | **Nowhere.** Never sent to a model | n/a |
| Everything else (index, wiki, chats) | Stays in the Postgres container on your machine | n/a |

When Claude Code answers through the [MCP server](mcp.md), the retrieved snippets go to Claude Code,
under your own Claude account's terms.

## Enforced by the app

- Every request asks for **zero data retention**: `provider.zdr = true` and
  `data_collection = "deny"` (`OPENROUTER_ZDR=true`). OpenRouter then only routes to endpoints
  that don't store prompts. A model with no such endpoint **fails** rather than falling back to one
  that keeps data. This is why the optional rerank step is off: no rerank model on OpenRouter has a
  zero-retention endpoint.
- Files containing anything key-shaped (AWS, GitHub, OpenAI, OpenRouter, Stripe, private keys, and
  high-entropy `api_key = ...` values) are dropped whole before they are chunked or embedded.
- The app and Postgres listen on `127.0.0.1` only.

## Set in your OpenRouter account (the app cannot do this for you)

In **Settings → Privacy**:

- [ ] **Zero Data Retention:** turn it on for *Anthropic*, *OpenAI* and *All other models*, with
  **Zero retention only** selected. Turn on any other provider you use too.
- [ ] **Data Training:** turn **off** all four options: paid endpoints that train, free endpoints
  that train, free endpoints that publish prompts, and the "1% data discount".

Elsewhere:

- [ ] **Keep prompt logging off,** and connect no observability or broadcast integrations; those copy
  every prompt to another service.
- [ ] **Give this app its own API key with a spending limit.** When the limit is reached, requests
  fail; the author job stops and pg-boss retries it later.

Account-level privacy settings apply to **every workspace and key** on the account, and workspace
[guardrails](https://openrouter.ai/docs/guides/features/guardrails) can only make them stricter.
If other apps share your OpenRouter account, check they still work, or put these rules on a
guardrail for this app's workspace instead.
