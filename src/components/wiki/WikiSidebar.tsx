import { BookOpen, ChevronsUpDown, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReposPanel } from "@/components/repos/ReposPanel";
import { db } from "@/db/client";
import { wikiStore } from "@/wiki/store";
import { wikiBase } from "@/wiki/routes";
import type { WikiRef } from "@/wikis/schema";
import { listWikis } from "@/wikis/wikis";
import { PageTree } from "./PageTree";

async function TreeLoader({ wiki }: { wiki: WikiRef }) {
  await connection();
  const store = wikiStore(wiki.id);
  const [tree, proposalCount] = await Promise.all([store.listTree(), store.countProposals()]);
  return <PageTree initialTree={tree} proposalCount={proposalCount} />;
}

const SWITCHER_ROW = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium";

/** The current wiki's name; opens a native <details> menu of the other wikis and "All wikis". */
async function WikiSwitcher({ wiki }: { wiki: WikiRef }) {
  await connection();
  const others = (await listWikis(db())).filter((w) => w.id !== wiki.id);
  return (
    <details className="group relative">
      <summary className={`${SWITCHER_ROW} cursor-pointer list-none hover:bg-surface [&::-webkit-details-marker]:hidden`}>
        <BookOpen className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate" title={wiki.name}>
          {wiki.name}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="sr-only">Switch wiki</span>
      </summary>
      <div className="absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-md border border-line bg-surface py-1 text-sm shadow-lg">
        {others.map((w) => (
          <Link key={w.id} href={wikiBase(w.slug)} className="truncate px-3 py-1.5 hover:bg-surface-2" title={w.name}>
            {w.name}
          </Link>
        ))}
        <Link
          href="/"
          className={`flex items-center gap-2 px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-foreground ${others.length > 0 ? "mt-1 border-t border-line pt-2" : ""}`}
        >
          <LayoutGrid className="size-4" /> All wikis
        </Link>
      </div>
    </details>
  );
}

/** Wiki switcher, then the page tree (wiki track) above the repos panel (ingest track). */
export function WikiSidebar({ wiki }: { wiki: WikiRef }) {
  return (
    <div className="flex flex-col">
      <div className="border-b border-line p-2">
        <Suspense
          fallback={
            <div className={SWITCHER_ROW}>
              <BookOpen className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{wiki.name}</span>
            </div>
          }
        >
          <WikiSwitcher wiki={wiki} />
        </Suspense>
      </div>
      <Suspense fallback={<p className="p-4 text-sm text-muted">Loading pages…</p>}>
        <TreeLoader wiki={wiki} />
      </Suspense>
      <ReposPanel wiki={wiki} />
    </div>
  );
}
