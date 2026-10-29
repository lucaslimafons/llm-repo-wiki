# Repositories: private repos and multi-repo projects

## Private repositories

Public repos work without a token. For private ones, give the worker read-only access:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
   Set **Resource owner** to you or the organization, **Repository access** to *Only select
   repositories*, and **Repository permissions → Contents** to *Read-only*. GitHub adds
   Metadata (read-only) itself. Nothing else is needed. An organization may have to approve the
   token before it works.
2. Add it to `.env.local` as `GITHUB_TOKEN=github_pat_...`.
3. Restart `pnpm worker` and `pnpm dev`, because both read the environment at start.
4. Add each repo with the sidebar's **Add repository** box, or `pnpm repo:add owner/name --wiki <slug>`.

Before adding private code, read [what leaves your machine](privacy.md).

**Repos under more than one owner.** A fine-grained token covers one owner. Give each other owner its
own token in `GITHUB_TOKENS=owner=token,other-owner=token`, and the worker sends each repo only its
owner's token. `GITHUB_TOKEN` stays the default for everyone else.

**Repos where you are only a collaborator** (someone else's personal account) cannot be reached by
your fine-grained token: GitHub does not list that account as a resource owner. Two ways in:

- **Best:** the owner creates the fine-grained token on their account (only those repos, Contents
  read-only) and gives it to you. Least privilege, and they can revoke it.
- **Fallback:** a [classic token](https://github.com/settings/tokens/new) with the `repo` scope. It
  reaches collaborator repos but grants read **and write** on every repo you can access, so give it
  a short expiry and list it only for that owner in `GITHUB_TOKENS`.

## Several repos, one project

The wiki documents one project, even when it spans several repos (an app and its website, say).
Create one wiki for the project. Before adding the repos, open the wiki's **Settings** and write a short brief:
what the project is, what each repo is for, and who the wiki is for. Give each repo a one-line role,
and pick a layout: **by topic** (one shared tree, each repo's subsystems under `Architecture/<part>`)
or **by repository** (a top-level folder per repo). Either way the top-level `Overview` and
`Architecture` describe the whole project and how the repos connect.

Both agents read that brief with every request. The author also searches every repo for evidence,
so a shared page such as `Overview` cites all of them. When a repo's outline names a page another
repo already wrote, the author proposes an update that adds this repo's side and keeps the page's
existing citations, instead of skipping the topic. The brief is the owner's intent, not a source:
every fact on a page still has to cite code.

## Several projects, several wikis

Unrelated projects go in separate wikis, and `/` lists them. A wiki is isolated: search, chat, the
author's evidence, lint, export, the Jobs page and the MCP server only ever see its own repos and
pages. Without that, adding a second project would leak its code into the first project's pages.

A repo belongs to exactly one wiki, because the same repo in two would be indexed and paid for twice.
Adding a repo that another wiki already holds is refused and names that wiki. Deleting a wiki, under
**Settings**, deletes its repos' index, pages, proposals, chats and history.

An existing install keeps its data: the migration moves everything into a wiki named `default`.
