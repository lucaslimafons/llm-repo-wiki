# Implementation plan

## 1. What this is

A wiki that writes and maintains itself from one or more GitHub repos. It is Karpathy's
[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) applied to code:

- **Sources:** repo files at a commit. Immutable, chunked, embedded.
- **Wiki:** markdown pages in the Azure DevOps folder model, written by an agent and reviewed by
  you.
- **Schema:** `WIKI_SCHEMA.md` governs how the agent writes.

Pitch: *DeepWiki is regenerated; this one is maintained.* Every claim cites
`path#L..@sha`, a merge updates only the pages it affects, and chat can both answer and edit.

There is **no separate "knowledge base" layer.** The wiki is the compiled knowledge, and a
second prose layer would only drift from it. Machine metadata (the catalog, the log, provenance)
lives in Postgres.

## 2. Decisions

| Concern | Choice | Why / rejected alternative |
|---|---|---|
| Agent loop | AI SDK v7 `ToolLoopAgent`, plain | Mastra's `MDocument`/`PgVector` would hide the RAG internals this project exists to teach. Vercel eve is beta, Vercel-bound and has no RAG. |
| LLMs | OpenRouter via `@openrouter/ai-sdk-provider` | Any model, one key; per-call cost from `providerMetadata.openrouter.usage.cost` |
| Embeddings | `openai/text-embedding-3-small`, 1536 dims | $0.02/M. `embedding_model` is stored on every row so a mix is detectable. |
| Vector store | pgvector 0.8.7, HNSW, `hnsw.iterative_scan = relaxed_order` | The iterative scan keeps a `WHERE repo = …` filter from returning too few rows |
| Retrieval | Hybrid: vector + `tsvector('simple')`, fused by RRF (k=60) in one SQL query | `simple` doesn't stem identifiers. Reranking is an optional later experiment. |
| Chunking | `code-chunk` (tree-sitter, cAST) for code; heading-split for markdown; line windows as fallback | `code-chunk` is v0.1, so it sits behind a `Chunker` interface |
| Fetch | `GET /repos/{o}/{r}/tarball/{sha}`, one call per repo | The Trees API costs one call per file |
| Incremental | Compare API `synced...desired`; re-embed only changed chunk hashes | 🔴 Compare caps at 300 files; above that, do a full hash reconcile |
| Jobs | pg-boss 12 in the same Postgres, consumed by a separate worker process | No Redis. `stately` + `singletonKey=repoId` means one sync per repo and the latest sha wins. |
| Trigger | Poll the default-branch head every N minutes, plus a Sync button. Webhook is optional (`gh webhook forward`). | Local-only: GitHub cannot reach localhost. A merged PR is a `push`, so never subscribe to both. |
| Wiki storage | Postgres is the truth, and Azure DevOps folder/git export is a target | Links are stored as `wiki:<uuid>`, so moves never rewrite bodies. Revisions give history and revert. |
| Writes | Chat with you present: `apply` (an accepted revision), and destructive tools need approval. Background agent: `propose` only. | GitBook's change-request pattern |
| Chat memory | Every `UIMessage` is stored whole. Reopening a session reloads it server-side. Old turns fold into `chats.summary`. | The client sends only the new message, so context never depends on the browser. |
| Sources | Every RAG-backed answer shows its sources, linking to GitHub at the exact sha and lines, and they persist with the message | You can always check where an answer came from |

## 3. Tracks

The foundation (this commit) holds: compose, schema and migrations, `src/core/contracts.ts`, the
queue, the worker entry, test infrastructure, the UI shell and these docs. Three tracks then run
in parallel, each in its own worktree, branch and test database. **Each track edits only its
own paths.** `package.json` and the lockfile are frozen: every dependency is already installed.

### Track A: ingest + search (`track/ingest`)
Owns `src/ingest/**`, `src/search/**`, `src/github/**`, `src/components/repos/**`,
`src/app/api/github/**`, `src/app/api/repos/**`, `eval/**`.

- **Repos:** add/remove/sync through Server Actions and a list endpoint. `ReposPanel` UI (add
  `owner/name`, status, last synced sha, Sync button).
- **GitHub client:** default branch, head sha, tarball stream-extract, compare. Token optional.
- **Filters:** binaries (NUL byte in the first 8KB), lockfiles, vendored/generated paths,
  `.gitattributes linguist-*`, files over 300KB, minified lines.
- **Secret scanner** (gitleaks-style rules plus entropy) before chunking. Matches are dropped and
  logged by rule name, never by value.
- **Chunkers** behind a `Chunker` interface (code-chunk, markdown, fallback). Lines are 1-based.
- **Embedder** behind an interface (OpenRouter `embedMany`, batched, 429 → throw so the job
  retries).
- **`sync-repo` job:** full on first sync, incremental via compare (added, modified, removed,
  renamed), one transaction per file, `synced_sha` advanced last. Then call
  `wikiStore.markStaleByFiles` and enqueue `author-wiki` with the changed paths.
- **`poll-repos`** scheduled every `POLL_INTERVAL_MINUTES`.
- **Webhook route:** HMAC on the raw body with `timingSafeEqual`, dedupe on `X-GitHub-Delivery`,
  `push` to the default branch only, sets `desired_sha`, enqueues, returns 202.
- **`index-page` job:** chunk and embed an accepted wiki revision into `wiki_chunks`.
- **`searchKnowledge`:** hybrid RRF over `source`, `wiki` or `all`, with a repo filter.
- **`pnpm eval`:** golden questions for a sample repo, reporting recall@5 and MRR for vector-only,
  full-text-only and hybrid.
- **Done when:** tests cover filters, the secret scanner, chunker line ranges, incremental
  rename/delete, RRF ordering and webhook signature (GitHub's test vector), and a real public repo
  syncs end to end.

### Track B: wiki (`track/wiki`)
Owns `src/wiki/**`, `src/export/**`, `src/components/wiki/**`, `src/components/markdown/**`,
`src/app/(wiki)/**` except the layout's chat slot.

- **`wikiStore`:** implements the contract, with Azure DevOps title rules (no `/ \ #`, no
  leading/trailing `.`, path ≤ 235). It also writes `wiki_log` on every write and enqueues
  `index-page` on accept.
- **UI:**
  - tree (create, rename, reorder);
  - page view;
  - `<Markdown>` with sanitize, Shiki, lazy mermaid, `[[_TOC_]]`, and `wiki:`/`source:` link
    resolution;
  - textarea editor with preview;
  - revision history and revert;
  - proposals queue with a diff and accept/reject;
  - stale badge.
- **`pnpm export --out <dir>`:** Azure DevOps layout (`Page.md` beside `Page/`, `.order`,
  encoded filenames, `.attachments/`). `wiki:` links become `/Parent/Child`, and citations become
  GitHub links.
- **`lint-wiki` job (deterministic part):** orphans, dead links, missing citations, citations to
  deleted files.
- **Done when:** tests cover tree ordering, move cycles refused, delete-with-children refused,
  propose → accept → current revision, stale marking, filename encoding round-trip and export
  snapshot.

### Track C: agent (`track/agent`)
Owns `src/agent/**`, `src/components/chat/**`, `src/app/api/chat/**`, and the chat slot of the
layout.

- **Model registry:** `CHAT_MODEL` and `AUTHOR_MODEL`. Usage and cost go to `agent_runs`.
- **Chat route:**
  - a `ToolLoopAgent` with `isStepCount(8)`;
  - tools: `searchKnowledge`, `listTree`, `readPage`, `createPage`, `updatePage`, `movePage`,
    `deletePage`, each zod-validated and taking a wiki-scoped store;
  - `toolApproval` set to user-approval for delete, move and updating an existing page;
  - retrieved text wrapped as data;
  - system prompt = role + `WIKI_SCHEMA.md` + the current tree as the index.
- **Sessions:**
  - `chats` and `chat_messages`, with each `UIMessage` stored whole;
  - list, open and new;
  - reopening loads the history server-side, and the client sends only the latest message;
  - when the history exceeds the budget, older turns fold into `chats.summary`.
- **Sources:** search hits are emitted as source parts on the assistant message (GitHub URL at
  sha#lines, or a wiki page link), rendered as a "Sources" list under the answer, and persisted.
- **Chat UI:** `useChat`, streaming, inline approval cards (with a diff for updates), source list,
  session switcher.
- **`author-wiki` job:**
  - first run: plan an outline under the schema and page budget, then write pages in `propose`
    mode with citations;
  - incremental runs: rewrite only stale or affected pages.
- **Done when:** tests with a mock model cover tool validation (path traversal, unknown ids),
  approval gating, the persistence round-trip including source parts, summary folding and
  author-job proposals.

## 4. After the merge (integration)

1. Run against a real repo with your key.
2. Measure the eval.
3. Write the README with a GIF.
4. Create the public GitHub repo.
