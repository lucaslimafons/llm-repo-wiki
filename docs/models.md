# Models and retrieval

The app uses two models, both through OpenRouter and both set in `.env.local`. The defaults come
from live evals on 2026-10-22 against `pmndrs/zustand@382d29c`; the full write-up (method,
charts, failure modes) is in [`evals.md`](evals.md). Reproduce with `pnpm eval`,
`pnpm bench:chat <models…>` and `pnpm bench:author <model> <owner/name> --wipe`.

| Role | Variable | Default | Why |
|---|---|---|---|
| Chat | `CHAT_MODEL` | `anthropic/claude-haiku-5.5` | 6/6 answers cited the right file, at $0.003 per answer and 9.9 s, the fastest of six models. Sonnet 5.5 scored the same at 22× the cost |
| Author | `AUTHOR_MODEL` | `anthropic/claude-haiku-5.5` | The only model that wrote a full wiki: 24/24 pages, 276 citations, 0 invented, $0.09 |
| Embeddings | `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | $0.02 per million tokens (all of zustand costs under half a cent), 1,536 dimensions, and a zero-retention endpoint |

Any OpenRouter model can be set in `.env.local`, but measure it first with `pnpm bench:chat` and
`pnpm bench:author`, and check that it has a zero-retention endpoint ([privacy](privacy.md)).

## Chat (6 golden questions, real agent)

| Model | Grounded | $/answer | s/answer |
|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 6/6 | 0.0031 | 9.9 |
| `deepseek/deepseek-v4.1-flash-1017` | 6/6 | 0.0040 | 14.7 |
| `anthropic/claude-sonnet-5.5` | 6/6 | 0.0683 | 14.5 |
| `google/gemini-3.7-flash` | 4/6, 1 timeout | 0.0303 | 42.3 |
| `z-ai/glm-5.3-flash` | 3/6 | 0.0014 | 20.7 |
| `openai/gpt-5.6-luna` | 3/6 | 0.0016 | 14.9 |

## Author (full wiki for zustand)

| Model | Pages written | Citations / invented | Cost | Time |
|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 24 of 24 | 276 / 0 | $0.091 | 9.6 min |
| `z-ai/glm-5.3-flash` | 1 of 26 (timeouts, uncited drafts) | 14 / 1 | $0.015 | 13 min |
| `deepseek/deepseek-v4.1-flash-1017` | 1 of 27 (outline copied the file tree) | 20 / 0 | $0.020 | 1.8 min |
| `deepseek/deepseek-v4-flash-0731` | 0 (reasoning ran to the token cap) | n/a | n/a | n/a |

The cheaper models failed in ways a price list doesn't show: DeepSeek V4 Flash reasoned until its
token limit and returned nothing, GLM 5.3 Flash planned a good outline but wrote 1 page of 26, and
DeepSeek V4.1 Flash planned one page per file instead of following the schema.

## Retrieval and reranking

Hybrid search is good at **recall**: the right chunk is usually somewhere in the top 30. It is
weaker at **order**. RRF rewards chunks that appear in both lists, so a chunk that merely repeats
common words can outrank the real answer. A **reranker** (a cross-encoder) reads the question and
each candidate together and reorders them by relevance. `/explain` in the app shows each of these
steps on your own question.

On 20 questions with a known answer file:

| Strategy | Right file in top 5 | Extra cost per search | Extra latency |
|---|---|---|---|
| Full-text only | 11 / 20 | n/a | n/a |
| Hybrid RRF | 16 / 20 | n/a | n/a |
| Vector only | 17 / 20 | n/a | n/a |
| Hybrid + `cohere/rerank-4-fast` | 18 / 20 | $0.002 | ~0.6 s |
| Hybrid + `cohere/rerank-4-pro` | **19 / 20** | $0.0025 | ~0.7 s |

The reranker is implemented ([`src/search/rerank.ts`](../src/search/rerank.ts), through
OpenRouter's `/rerank`) and used by `pnpm eval`, but search does not call it. It can't be on by
default: every rerank model on OpenRouter runs on a provider endpoint without zero data retention,
so it would send code outside the `OPENROUTER_ZDR` guarantee. It would matter for the wiki too: the
author can only cite what search returns.
