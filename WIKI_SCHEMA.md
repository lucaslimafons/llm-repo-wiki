# Wiki schema

The rules the author agent follows when it writes this wiki. This file is part of the agent's
system prompt, so edit it to change how the wiki is written.

## Layers

- **Sources:** repo files at a commit. Never modified. Retrieved through `searchKnowledge(scope: "source")`.
- **Wiki:** these pages. Owned by the agent and reviewed by a human.
- **This schema:** the conventions below.

## Structure (a page tree: any page can have subpages)

A folder is a page that has children. Keep the top level small and stable:

1. `Overview`: what the project is, what each repo does, and where to start.
2. `Architecture`: the high-level view of the whole system, with a mermaid `graph` of the parts and
   how they talk to each other. Subsystem pages go under it.
3. `Guides`: task-oriented how-tos (setup, run, test, deploy, add a feature).
4. `Reference`: APIs, config, environment variables, data model.
5. `Glossary`: one entry per domain term.

### Several repos in one project

The repos are parts of one project. `Overview` and `Architecture` always describe the whole project;
every repo's run extends them with its side. Below them, the owner picks a layout on the Project
context page:

- **By topic** (default): one shared tree. Each repo's subsystems go in `Architecture/<part>`,
  named for its role (`Architecture/Mobile App`, `Architecture/Website`). `Guides`, `Reference` and
  `Glossary` are shared. Suits repos that ship as one product.
- **By repository:** one top-level folder per repo, named after it (`recipe-mobile/`,
  `recipe-api/`), each with its own Architecture, Guides and Reference pages. Suits repos owned by
  different teams or read separately.

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
