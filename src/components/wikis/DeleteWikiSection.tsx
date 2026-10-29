"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { deleteWikiAction } from "@/wikis/actions";
import { useWiki } from "./WikiContext";

/** Danger zone: the delete button arms only once the wiki's name is typed exactly (the action checks it again). */
export function DeleteWikiSection() {
  const { slug, name } = useWiki();
  const [typed, setTyped] = useState("");
  // On success the action redirects to the wiki list, so only a refusal comes back.
  const remove = useMutation({
    mutationFn: async () => {
      const r = await deleteWikiAction(slug, typed);
      if (!r.ok) throw new Error(r.error);
    },
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (typed === name) remove.mutate();
  };

  return (
    <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-8">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-md border border-danger/40 p-4 text-sm">
        <div>
          <h2 className="font-medium text-danger">Delete wiki</h2>
          <p className="mt-1 text-muted">
            Deletes this wiki with its repositories&apos; index, pages, proposals, chats and history. It cannot be undone; the
            GitHub repositories themselves are not touched.
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span>
            Type <strong className="font-medium break-all">{name}</strong> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="rounded border border-line bg-surface px-3 py-1.5 outline-none focus:border-danger"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={typed !== name || remove.isPending}
            className="flex items-center gap-2 rounded border border-danger px-3 py-1.5 text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete this wiki
          </button>
          {remove.error && <span className="text-danger">{remove.error.message}</span>}
        </div>
      </form>
    </section>
  );
}
