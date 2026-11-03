# Use it from Claude Code (MCP)

`pnpm mcp` starts a local [MCP](https://modelcontextprotocol.io) server over stdio, with no network
listener. Claude Code, or any MCP client, can then search one wiki's repos, read its pages and see
how fresh the index is, instead of grepping several repos.

## Set up

Register it once, at user scope, so it works in every repo you open:

```bash
claude mcp add --transport stdio -s user llm-repo-wiki -- pnpm --silent --dir /path/to/llm-repo-wiki mcp --wiki <slug>
claude mcp list                                  # llm-repo-wiki should show ✓ connected
pnpm mcp:smoke "how are repositories synced" --wiki <slug>   # optional: call it the way Claude Code will
```

One server answers from one wiki. `--wiki` is optional while only one wiki exists; with several,
the server refuses to start without it and lists them. For two projects, register two servers under
different names (e.g. `wiki-shop` and `wiki-blog`), each with its own `--wiki`. In a project's
`.mcp.json`, register only that project's wiki.

It needs the Postgres container running. Keep `pnpm worker` running too, so the index follows your
default branches. Tools load when a Claude Code session starts: open a new session after adding it,
and check with `/mcp`.

## Tools

| Tool | What it returns |
|---|---|
| `search_knowledge` | Ranked snippets from every repo, each with `repo/path#lines@sha`, a GitHub permalink and the wiki pages that cite the file, plus how fresh the index is |
| `read_page` | One wiki page with citations as permalinks. A page not reviewed yet comes back labelled as an unreviewed proposal |
| `list_pages` | The page tree |
| `repo_status` | Per repo: the indexed commit vs. the newest head the worker saw, sync and authoring state |
| `sync_repo` | Queues a re-index, like the Sync button. The only tool that changes anything |

The server's instructions tell Claude when to use the index: questions that span files or repos,
or getting oriented. They also say when to grep instead: exact strings, every occurrence, or before
editing a file. Snippets come back as quoted `<retrieved>` data, never as instructions.

## Search profiles

`MCP_PROFILE` sets how much one `search_knowledge` call returns:

| Profile | Hits | Per file | Snippet | Tool loading |
|---|---|---|---|---|
| `compact` (default) | 5 | best chunk only | 500 chars | loaded at session start |
| `full` | 8 | every ranked chunk | 1,500 chars | through Claude Code's tool search |

Compact exists because full results were large: one search cost about as much context as several
file reads, and Claude read the files anyway. Compact points Claude at the right files and lets it
read them. In the benchmark below it used fewer tokens than `full` and needed no tool-search turn.
Set `MCP_PROFILE=full` if you want more code inline per search. A caller can still pass `limit`.

Your questions are answered by Claude Code, on your own Claude plan. The wiki only retrieves, at
the cost of one query embedding per search.

## Measuring it

Whether it saves tokens or time is measured, not assumed. `pnpm bench:mcp` runs each question
through `claude -p` once per arm: `grep` (built-in tools only), `mcp` (plus the MCP tools, `full`
profile) and `mcp-compact` (the `compact` profile). The arms are identical otherwise. It records tokens,
turns, time, which tools were called, whether MCP connected, and how many expected files the answer
names. It runs on your Claude Code login; no API key is needed.

```bash
cp eval/mcp-bench.example.json eval/mcp-bench.local.json   # edit workdir, addDirs, questions
# or run the public question set on pmndrs/zustand: eval/mcp-bench.zustand.json (see evals.md)
pnpm bench:mcp --runs 1          # a first look
pnpm bench:mcp --runs 3          # enough runs to see past the noise
pnpm bench:mcp --arms grep,mcp,mcp-compact   # compare both profiles (default: grep,mcp-compact)
```

`eval/mcp-bench.local.json` and `eval/results/` are gitignored, because both quote your repos.

Three things decide whether the numbers mean anything:

- **The working folder must hold only the indexed repos.** Point `workdir` at one of them and list
  the others in `addDirs`. A parent folder full of other clones lets the grep-only run search stale
  copies, which inflates the MCP side's advantage. In `claude -p`, Read, Grep and Glob can still
  reach files outside those folders without asking, for example a path named in your Claude Code
  memory. For a clean run, use a folder that holds only fresh clones of the indexed repos.
- **Run each question at least 3 times.** Single runs of the same question vary by 2× in tokens.
- **Read the answers.** "Expected-file recall" only checks which files an answer names. Answers
  built from snippets alone can name fewer files and still be right, or the reverse.

The pass bar is set in the script before any run: at most 0.7× the tokens of grep alone, with no
more than 0.05 lower recall. What the first runs found, and why neither profile passes yet, is in
[`evals.md`](evals.md#eval-5-mcp-server-vs-grep).
