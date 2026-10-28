# Configuration and scripts

## Environment

All settings live in `.env.local` ([`.env.example`](../.env.example) lists them). They are validated
at start.

| Variable | Default | What it does |
|---|---|---|
| `OPENROUTER_API_KEY` | none (required for sync and chat) | Your OpenRouter key. Without it the wiki still opens, but nothing can be embedded or written |
| `GITHUB_TOKEN` | none | Needed for private repos. Without it, public repos work at GitHub's 60 requests/hour |
| `GITHUB_TOKENS` | none | Per-owner tokens, `owner=token,other-owner=token`, for repos under other accounts. Owners not listed use `GITHUB_TOKEN` |
| `CHAT_MODEL` | `anthropic/claude-haiku-5.5` | The model you chat with |
| `AUTHOR_MODEL` | `anthropic/claude-haiku-5.5` | The model that writes and updates pages in the background |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Must return 1,536 dimensions. Changing it means re-embedding everything (`pnpm db:reset`, then add the repos again) |
| `RERANK_MODEL` | `cohere/rerank-4-pro` | Used only by the optional rerank step on `/explain`, one paid call per click. Off while `OPENROUTER_ZDR=true`: no rerank model on OpenRouter has a zero-retention endpoint |
| `OPENROUTER_ZDR` | `true` | Every model call requires a zero-data-retention endpoint. Keep it on for private code |
| `POLL_INTERVAL_MINUTES` | `5` | How often the worker checks each repo for new commits |
| `AUTHOR_TOKEN_BUDGET` | `800000` | Input + output tokens one author run may spend. When it runs out, the run stops cleanly as `budget_exceeded` and keeps the pages it wrote |
| `GITHUB_WEBHOOK_SECRET` | none | Optional. Enables the webhook route instead of waiting for the next poll (see below) |
| `DATABASE_URL` | the local Docker Postgres | Only change it if you run Postgres elsewhere |

## New commits: polling and the optional webhook

New commits are found by polling, because GitHub cannot reach a laptop. To react instantly while
developing, set `GITHUB_WEBHOOK_SECRET` and forward events with:

```bash
gh webhook forward --repo owner/name --events push \
  --url http://127.0.0.1:3000/api/github/webhook --secret <same secret>
```

Only a `push` to the default branch triggers a sync. A merged PR produces exactly that push.

## Scripts

| Command | What it does |
|---|---|
| `pnpm db:setup` | Start Postgres in Docker and run migrations. Not `pnpm setup`, which is a pnpm built-in |
| `pnpm db:reset` | **Delete all data** (repos, wiki, chats) and start from an empty schema |
| `pnpm dev` / `pnpm worker` | Web app / background job worker |
| `pnpm repo:add owner/name` | Add a repo and queue its first sync |
| `pnpm export --out <dir>` | Write the accepted wiki as a folder of markdown that renders on GitHub |
| `pnpm eval` | Retrieval eval: 8 search strategies, recall@5 and MRR |
| `pnpm bench:chat`, `pnpm bench:author` | Compare models on the real chat agent and author job |
| `pnpm mcp` / `pnpm mcp:smoke "question"` | Run the MCP server over stdio / check it end to end as a client would |
| `pnpm bench:mcp` | Claude Code with vs. without the MCP server ([how it works](mcp.md#measuring-it)) |
| `pnpm test` / `pnpm typecheck` / `pnpm lint` | Tests against a real Postgres, plus checks |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `pnpm setup` prints a message about your shell and creates no database | That's pnpm's own command. Use `pnpm db:setup` |
| `402 Insufficient credits` | The OpenRouter account has no purchased credits. A key limit is not credit |
| `404` from OpenRouter, or "No endpoints found" | The model has no zero-retention endpoint, or your account settings exclude it |
| A private repo is "not found" | No token for its owner (`GITHUB_TOKEN` / `GITHUB_TOKENS`), the token lacks that repo, it awaits organization approval, or you are a collaborator on a personal account (see [repositories](repositories.md#private-repositories)) |
| Pages render without the board or line styles after pulling new CSS | Next's dev cache kept an old `globals.css`. Stop `pnpm dev`, move `.next/dev` aside, start again |
