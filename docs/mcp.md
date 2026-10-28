# Use it from Claude Code (MCP)

`pnpm mcp` starts a local [MCP](https://modelcontextprotocol.io) server over stdio, with no network
listener. Claude Code, or any MCP client, can then search every indexed repo, read the wiki and see
how fresh the index is, instead of grepping several repos.

## Set up

Register it once, at user scope, so it works in every repo you open:

```bash
claude mcp add --transport stdio -s user llm-repo-wiki -- pnpm --silent --dir /path/to/llm-repo-wiki mcp
claude mcp list                                  # llm-repo-wiki should show ✓ connected
pnpm mcp:smoke "how are repositories synced"     # optional: call it the way Claude Code will
```

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

Your questions are answered by Claude Code, on your own Claude plan. The wiki only retrieves, at
the cost of one query embedding per search.

## Measuring it

Whether it saves tokens or time is measured, not assumed. `pnpm bench:mcp` runs each question
through `claude -p` twice, identical except that one run also has the MCP tools. It records tokens,
turns, time, which tools were called, whether MCP connected, and how many expected files the answer
names. It runs on your Claude Code login; no API key is needed.

```bash
cp eval/mcp-bench.example.json eval/mcp-bench.local.json   # edit workdir, addDirs, questions
pnpm bench:mcp --runs 1          # a first look
pnpm bench:mcp --runs 3          # enough runs to see past the noise
```

`eval/mcp-bench.local.json` and `eval/results/` are gitignored, because both quote your repos.

Three things decide whether the numbers mean anything:

- **The working folder must hold only the indexed repos.** Point `workdir` at one of them and list
  the others in `addDirs`. A parent folder full of other clones lets the grep-only run search stale
  copies, which inflates the MCP side's advantage. The harness also leaves Read, Grep and Glob to
  Claude Code's defaults, so they stay inside those folders.
- **Run each question at least 3 times.** Single runs of the same question vary by 2× in tokens.
- **Read the answers.** "Expected-file recall" only checks which files an answer names. Answers
  built from snippets alone can name fewer files and still be right, or the reverse.

The pass bar is set in the script before any run: at most 0.7× the tokens of grep alone, with no
more than 0.05 lower recall. Published results will come from public repos, with the questions
committed; see [`evals.md`](evals.md).
