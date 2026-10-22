# Choosing models

The app uses two models, both through OpenRouter and both set in `.env.local`.

| Role | Variable | What it does | What matters |
|---|---|---|---|
| Chat | `CHAT_MODEL` | Answers you live; searches, reads and edits pages through tools | Tool-calling reliability, latency |
| Author | `AUTHOR_MODEL` | Writes and updates pages in the background after each sync | Price per input token (it reads a lot), structured output, citing accurately |

## Snapshot (2026-10-22)

τ²-Bench Airline is [OpenRouter's multi-step tool-calling benchmark](https://openrouter.ai/benchmarks/tau2-bench-airline).
Prices are USD per million tokens and come from the OpenRouter models API.

| Model | τ²-Bench | $/task | In / out | Notes |
|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | 78.7% | 0.16 | 2.00 / 10.00 | Best quality; ~15× Haiku per task |
| `google/gemini-3.7-flash` | 78.3% | 0.15 | 0.75 / 3.75 | |
| `z-ai/glm-5.3` | 77.5% | 0.061 | 0.70 / 2.20 | |
| `deepseek/deepseek-v4.1-flash-1017` | 76.7% | 0.021 | 0.15 / 0.60 | Chat alternative |
| **`anthropic/claude-haiku-5.5`** | 76.0% | 0.011 | 0.10 / 0.50 | **Default chat** |
| `z-ai/glm-5.3-flash` | 75.9% | 0.007 | 0.005 / 0.20 | Very cheap, new |
| **`deepseek/deepseek-v4-flash-0731`** | 73.9% | 0.009 | 0.044 / 0.133 | **Default author**; cache reads 0.001 |
| `moonshotai/kimi-k2.6` | 74.1% | 0.069 | 0.65 / 3.41 | |
| `openai/gpt-5.6-luna` | 70.0% | 0.011 | 0.20 / 1.20 | |

τ²-Bench measures tool use in a customer-support simulation. It does not measure how well a
model writes docs or how faithfully it cites, so measure that on your own repos. Every run's
real cost lands in `agent_runs.cost_usd`.

## Privacy

OpenRouter routes some open-weight models to several hosts. If you index private code, restrict
routing to providers that don't retain or train on prompts, using OpenRouter's privacy settings
or the `data_collection: "deny"` provider preference.
