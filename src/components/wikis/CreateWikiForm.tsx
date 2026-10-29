"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LAYOUT_OPTIONS } from "@/components/project/layouts";
import { MAX_CONTEXT_CHARS, type WikiLayout } from "@/project/schema";
import { wikiBase } from "@/wiki/routes";
import { createWikiAction } from "@/wikis/actions";
import { MAX_WIKI_NAME_CHARS } from "@/wikis/schema";


/** Name, optional brief and layout; on success it opens the new wiki. */
export function CreateWikiForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [layout, setLayout] = useState<WikiLayout>("topic");
  const create = useMutation({
    mutationFn: async () => {
      const r = await createWikiAction({ name, context, layout });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    onSuccess: (wiki) => router.push(wikiBase(wiki.slug)),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-5 text-sm">
      <h2 className="text-base font-semibold">New wiki</h2>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={MAX_WIKI_NAME_CHARS}
          placeholder="e.g. Acme Shop"
          className="rounded border border-line bg-background px-3 py-1.5 outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Brief <span className="font-normal text-muted">(optional)</span>
        </span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          maxLength={MAX_CONTEXT_CHARS}
          rows={4}
          placeholder="What the project is, how its repositories fit together, and who the wiki is for."
          className="rounded border border-line bg-background px-3 py-2 outline-none focus:border-accent"
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Layout</legend>
        {LAYOUT_OPTIONS.map((l) => (
          <label key={l.value} className="flex items-start gap-2 rounded border border-line px-3 py-2">
            <input type="radio" name="layout" value={l.value} checked={layout === l.value} onChange={() => setLayout(l.value)} className="mt-1" />
            <span className="min-w-0">
              <span className="font-medium">{l.label}</span>
              <span className="block text-xs text-muted">{l.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="flex items-center gap-2 rounded bg-accent px-3 py-1.5 text-accent-foreground disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create wiki
        </button>
        {create.error && <span className="text-danger">{create.error.message}</span>}
      </div>
    </form>
  );
}
