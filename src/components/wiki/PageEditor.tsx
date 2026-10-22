"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Save, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PageView } from "@/core/contracts";
import { queryKeys } from "@/lib/query-keys";
import { savePageAction } from "@/app/(wiki)/actions";
import { Markdown } from "@/components/markdown/Markdown";
import type { WikiPaths } from "@/components/markdown/plugins";
import { wikiRoute } from "@/wiki/routes";

/** Textarea + live preview. Saves against the revision it opened, so a concurrent edit conflicts. */
export function PageEditor({ page, wikiPaths, onDone }: { page: PageView; wikiPaths: WikiPaths; onDone: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.bodyMd);
  const [showPreview, setShowPreview] = useState(true);
  const save = useMutation({
    mutationFn: async () => {
      const res = await savePageAction({
        pageId: page.id,
        bodyMd: body,
        title: title === page.title ? undefined : title,
        baseRevisionId: page.revisionId,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all });
      if (saved.path !== page.path) router.replace(wikiRoute(saved.path));
      onDone();
    },
  });
  const dirty = title !== page.title || body !== page.bodyMd;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xl font-semibold outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-sm ${showPreview ? "bg-surface-2" : "hover:bg-surface-2"}`}
          aria-pressed={showPreview}
        >
          <Eye className="size-4" /> Preview
        </button>
        <button
          type="button"
          onClick={() => (!dirty || window.confirm("Discard your changes?")) && onDone()}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
        >
          <X className="size-4" /> Cancel
        </button>
        <button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          <Save className="size-4" /> {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {save.error && (
        <p role="alert" className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-danger">
          {save.error.message}
        </p>
      )}
      <div className={`grid gap-4 ${showPreview ? "xl:grid-cols-2" : ""}`}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          aria-label="Markdown"
          className="min-h-[60vh] w-full resize-y rounded-md border border-line bg-surface p-3 font-mono text-[13px] leading-6 outline-none focus:border-accent"
        />
        {showPreview && (
          <div className="min-h-[60vh] overflow-auto rounded-md border border-line bg-surface p-4">
            <Markdown wikiPaths={wikiPaths}>{body}</Markdown>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Cite code as <code className="font-mono">[path#L1-L9](source:owner/repo/path#L1-L9@sha)</code>; link pages as{" "}
        <code className="font-mono">[Title](wiki:&lt;page id&gt;)</code>. Citations are collected from the body on save.
      </p>
    </div>
  );
}
