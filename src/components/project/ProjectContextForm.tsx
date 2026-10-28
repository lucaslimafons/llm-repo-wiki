"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { saveProjectContextAction } from "@/project/actions";
import { MAX_CONTEXT_CHARS, MAX_ROLE_CHARS, type ProjectContext, type ProjectContextInput, type WikiLayout } from "@/project/schema";

const LAYOUTS: { value: WikiLayout; label: string; hint: string }[] = [
  { value: "topic", label: "By topic", hint: "One shared tree; each repo's subsystems under Architecture/<part>. For repos that ship as one product." },
  { value: "repo", label: "By repository", hint: "A top-level folder per repo with its own Architecture, Guides and Reference. For repos read separately." },
];

const PLACEHOLDER = `Chef Hugo is a recipe app.
recipe-mobile is the Expo app users cook with; recipe-site is the marketing website and its AWS hosting.
Write for a new engineer joining the team.`;

export function ProjectContextForm({ initial }: { initial: ProjectContext }) {
  const [context, setContext] = useState(initial.context);
  const [layout, setLayout] = useState<WikiLayout>(initial.layout);
  const [roles, setRoles] = useState<Record<string, string>>(() => Object.fromEntries(initial.repos.map((r) => [r.id, r.role ?? ""])));
  const save = useMutation({
    mutationFn: async (input: ProjectContextInput) => {
      const r = await saveProjectContextAction(input);
      if (!r.ok) throw new Error(r.error);
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate({ context, layout, roles: Object.entries(roles).map(([repoId, role]) => ({ repoId, role })) });
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Project context</h1>
        <p className="mt-1 text-sm text-muted">
          A short brief the author and chat agents read with every request: what the project is, how the repositories fit
          together, and who the wiki is for. It applies from the next run on; existing pages are not rewritten.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Brief</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          maxLength={MAX_CONTEXT_CHARS}
          rows={8}
          placeholder={PLACEHOLDER}
          className="rounded border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
        />
        <span className="self-end text-xs text-muted">
          {context.length}/{MAX_CONTEXT_CHARS}
        </span>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Wiki layout</legend>
        <p className="text-xs text-muted">Either way, the top-level Overview and Architecture describe the whole project.</p>
        {LAYOUTS.map((l) => (
          <label key={l.value} className="flex items-start gap-2 rounded border border-line bg-surface px-3 py-2">
            <input type="radio" name="layout" value={l.value} checked={layout === l.value} onChange={() => setLayout(l.value)} className="mt-1" />
            <span className="min-w-0">
              <span className="font-medium">{l.label}</span>
              <span className="block text-xs text-muted">{l.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Repository roles</legend>
        {initial.repos.length === 0 && <p className="text-muted">Add a repository first.</p>}
        {initial.repos.map((r) => (
          <label key={r.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="min-w-0 font-mono text-xs break-all sm:w-56 sm:shrink-0">{r.fullName}</span>
            <input
              value={roles[r.id] ?? ""}
              onChange={(e) => setRoles((prev) => ({ ...prev, [r.id]: e.target.value }))}
              maxLength={MAX_ROLE_CHARS}
              placeholder="e.g. mobile app, marketing website, API"
              className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 outline-none focus:border-accent"
            />
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        {save.isSuccess && <span className="text-sm text-success">Saved.</span>}
        {save.error && <span className="text-sm text-danger">{save.error.message}</span>}
      </div>
    </form>
  );
}
