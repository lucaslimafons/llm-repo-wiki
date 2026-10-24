# Choosing models

The app uses two models, both through OpenRouter and both set in `.env.local`. The defaults come
from live evals on 2026-10-22 against `pmndrs/zustand@382d29c`; the full write-up (method,
charts, failure modes) is in [`evals.md`](evals.md). Reproduce with `pnpm eval`,
`pnpm bench:chat <models…>` and `pnpm bench:author <model> <owner/name> --wipe`.

| Role | Variable | Default | Why |
|---|---|---|---|
| Chat | `CHAT_MODEL` | `anthropic/claude-haiku-5.5` | 6/6 answers cited the right file, at $0.003 per answer and 9.9 s, the fastest of six models |
| Author | `AUTHOR_MODEL` | `anthropic/claude-haiku-5.5` | The only model that wrote a full wiki: 24/24 pages, 276 citations, 0 invented, $0.09 |

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

## Retrieval (20 golden questions)

Hybrid search + `cohere/rerank-4-pro` reached recall@5 0.95 (vector-only 0.85, hybrid RRF 0.80)
for $0.0025 and ~0.65 s extra per search. The reranker is measured but not on by default yet.

## Privacy

OpenRouter routes some open-weight models to several hosts. If you index private code, restrict
routing to providers that don't retain or train on prompts, using OpenRouter's privacy settings
or the `data_collection: "deny"` provider preference.
