"use client";

import { AlertTriangle, History, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PageView as Page } from "@/core/contracts";
import type { WikiPaths } from "@/components/markdown/plugins";
import { historyRoute, wikiRoute } from "@/wiki/routes";
import { Disclosure } from "@/components/ui/Disclosure";
import { useWiki } from "@/components/wikis/WikiContext";
import { PageEditor } from "./PageEditor";

/** Server-rendered body as `children`; edit mode swaps in the client editor with a live preview. */
export function PageView({
  page,
  wikiPaths,
  staleFiles,
  review,
  sourceCount,
  startEditing,
  citations,
  children,
}: {
  page: Page;
  wikiPaths: WikiPaths;
  staleFiles: string[];
  /** The pending proposal's review panel, when there is one. */
  review: ReactNode;
  sourceCount: number;
  startEditing: boolean;
  citations: ReactNode;
  children: ReactNode;
}) {
  const { slug } = useWiki();
  const [editing, setEditing] = useState(startEditing && page.revisionId !== null);
  const crumbs = page.path.split("/");

  return (
    <article className="mx-auto max-w-4xl px-8 py-6">
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
        {crumbs.slice(0, -1).map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <Link href={wikiRoute(slug, crumbs.slice(0, i + 1).join("/"))} className="hover:text-foreground">
              {c}
            </Link>
            <span>/</span>
          </span>
        ))}
      </nav>

      {editing ? (
        <PageEditor page={page} wikiPaths={wikiPaths} onDone={() => setEditing(false)} />
      ) : (
        <>
          <header className="mb-4 flex items-start gap-3">
            <h1 className="min-w-0 flex-1 text-3xl font-semibold tracking-tight break-words">{page.title}</h1>
            <div className="flex shrink-0 gap-2 pt-1">
              <button
                type="button"
                disabled={page.revisionId === null}
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                <Pencil className="size-4" /> Edit
              </button>
              <Link
                href={historyRoute(slug, page.path)}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2"
              >
                <History className="size-4" /> History
              </Link>
            </div>
          </header>

          {page.stale && (
            <div role="status" className="mb-4 flex gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium text-warning">This page may be out of date.</p>
                <p className="text-muted">
                  {staleFiles.length > 0 ? (
                    <>
                      Changed since it was written:{" "}
                      {staleFiles.map((f, i) => (
                        <span key={f}>
                          {i > 0 && ", "}
                          <code className="font-mono text-xs">{f}</code>
                        </span>
                      ))}
                    </>
                  ) : (
                    "A file it cites changed since it was written."
                  )}
                </p>
              </div>
            </div>
          )}

          {review}

          {children}

          <section className="mt-10 border-t border-line pt-4">
            <Disclosure summary={<span className="text-sm">{`Sources (${sourceCount})`}</span>}>{citations}</Disclosure>
          </section>
          <p className="mt-6 text-xs text-muted">Updated {page.updatedAt.slice(0, 16).replace("T", " ")} UTC</p>
        </>
      )}
    </article>
  );
}
