"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { addRepoAction, removeRepoAction, syncRepoNowAction } from "@/ingest/actions";
import type { ActionResult, RepoListItem } from "@/ingest/repos";
import { queryKeys } from "@/lib/query-keys";

const POLL_MS = 2000;

async function fetchRepos(): Promise<RepoListItem[]> {
  const res = await fetch("/api/repos", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load repositories (${res.status})`);
  return res.json();
}

/** Unwraps an action result so a refusal surfaces as a mutation error, not a silent success. */
async function unwrap<T>(p: Promise<ActionResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const isBusy = (r: RepoListItem) => r.status === "queued" || r.status === "syncing";

export function ReposPanelClient({ initialRepos }: { initialRepos: RepoListItem[] | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const repos = useQuery({
    queryKey: queryKeys.repos.list(),
    queryFn: fetchRepos,
    initialData: initialRepos ?? undefined,
    // Poll only while some sync is pending; an idle sidebar makes no requests.
    refetchInterval: (q) => (q.state.data?.some(isBusy) ? POLL_MS : false),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.repos.all });

  const add = useMutation({
    mutationFn: (fullName: string) => unwrap(addRepoAction(fullName)),
    onSuccess: () => {
      setName("");
      return invalidate();
    },
  });
  const sync = useMutation({ mutationFn: (id: string) => unwrap(syncRepoNowAction(id)), onSettled: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => unwrap(removeRepoAction(id)), onSettled: invalidate });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  };
  const onRemove = (r: RepoListItem) => {
    if (window.confirm(`Remove ${r.fullName} and its indexed chunks?`)) remove.mutate(r.id);
  };
  const actionError = add.error ?? sync.error ?? remove.error;

  return (
    <section className="flex flex-col gap-2 border-t border-line p-3 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Repositories</h2>

      <form onSubmit={onSubmit} className="flex gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="owner/name"
          aria-label="Repository (owner/name)"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={add.isPending || !name.trim()}
          aria-label="Add repository"
          className="rounded border border-line bg-surface px-2 text-accent disabled:opacity-50"
        >
          {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </button>
      </form>

      {actionError && <p className="text-xs text-danger">{actionError.message}</p>}
      {repos.error && <p className="text-xs text-danger">{repos.error.message}</p>}
      {repos.isPending && <p className="text-xs text-muted">Loading…</p>}
      {repos.data?.length === 0 && <p className="text-xs text-muted">No repositories yet.</p>}

      <ul className="flex flex-col gap-1">
        {repos.data?.map((r) => (
          <li key={r.id} className="rounded border border-line bg-surface px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <StatusIcon status={r.status} />
              <span className="min-w-0 flex-1 truncate font-medium" title={r.fullName}>
                {r.fullName}
              </span>
              <button
                type="button"
                onClick={() => sync.mutate(r.id)}
                disabled={isBusy(r) || sync.isPending}
                aria-label={`Sync ${r.fullName}`}
                className="text-muted hover:text-accent disabled:opacity-40"
              >
                <RefreshCw className={`size-3.5 ${r.status === "syncing" ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => onRemove(r)}
                disabled={remove.isPending}
                aria-label={`Remove ${r.fullName}`}
                className="text-muted hover:text-danger disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <GitBranch className="size-3" />
              <span className="truncate">{r.defaultBranch ?? "?"}</span>
              <span className="font-mono">@{r.syncedSha ? r.syncedSha.slice(0, 7) : "—"}</span>
              <span className="ml-auto">{r.fileCount} files</span>
            </div>
            {r.lastError && (
              <p className="mt-0.5 line-clamp-2 text-xs text-danger" title={r.lastError}>
                {r.lastError}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusIcon({ status }: { status: RepoListItem["status"] }) {
  const label = { idle: "Synced", queued: "Queued", syncing: "Syncing", error: "Error" }[status];
  const icon = {
    idle: <CheckCircle2 className="size-3.5 text-success" />,
    queued: <Clock className="size-3.5 text-muted" />,
    syncing: <Loader2 className="size-3.5 animate-spin text-accent" />,
    error: <AlertCircle className="size-3.5 text-danger" />,
  }[status];
  return (
    <span title={label} aria-label={label} className="shrink-0">
      {icon}
    </span>
  );
}
