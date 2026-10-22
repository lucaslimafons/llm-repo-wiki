# LLM Repo Wiki

A wiki that writes and maintains itself from your GitHub repos: Karpathy's
[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) applied to code,
with hybrid RAG on Postgres + pgvector.

> Work in progress. See [`docs/plan.md`](docs/plan.md).

```bash
cp .env.example .env.local   # add your OPENROUTER_API_KEY
pnpm install
pnpm setup                   # postgres + pgvector in docker, migrations
pnpm dev                     # http://localhost:3000
pnpm worker                  # in a second terminal
```
