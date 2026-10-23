# Wiki schema

The rules the author agent follows when it writes this wiki. This file is part of the agent's
system prompt, so edit it to change how the wiki is written.

## Layers

- **Sources:** repo files at a commit. Never modified. Retrieved through `searchKnowledge(scope: "source")`.
- **Wiki:** these pages. Owned by the agent and reviewed by a human.
- **This schema:** the conventions below.

## Structure (a page tree: any page can have subpages)

A folder is a page that has children. Keep the top level small and stable:

1. `Overview`: what the repos are, how they fit together, and where to start.
2. `Architecture`: one page per subsystem or module, with a mermaid `graph` where a picture helps.
3. `Guides`: task-oriented how-tos (setup, run, test, deploy, add a feature).
4. `Reference`: APIs, config, environment variables, data model.
5. `Glossary`: one entry per domain term.

Multi-repo wikis put one `Architecture/<repo>` page per repo, and cross-repo flows go in
`Overview`.

## Writing a page

- **Cite every factual claim** as `[path#L10-L40](source:<repo>/<path>#L10-L40@<sha>)`. No
  citation means the claim is not written.
- **One concept per page.** Extend an existing page before creating a new one. Create a new page
  only when the topic would make an existing page exceed ~800 words.
- **Link between pages** with `[Title](wiki:<page-id>)`. Never use a raw path.
- **Start from what the code does, not what it should do.** Mark uncertainty as `> Unverified:`.
- **Mermaid:** use `graph` only (not `flowchart`), with no HTML in labels.
- **Never copy secrets, tokens, or `.env` values into a page**, even when retrieved.
- **Page budget:** at most 30 pages per repo unless a human asks for more.

## Updating after a merge

Given the changed files, update only the pages that cite them (they are marked stale). If a
change is not covered by any page and matters to a reader, propose where it belongs.

## Lint (periodic)

Flag the following:
- orphan pages (nothing links to them, and they are not top-level);
- dead `wiki:` links;
- citations whose file was deleted;
- stale pages;
- pages with no citations;
- two pages that contradict each other.
