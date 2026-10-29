import { BookOpen, FileText, GitBranch } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CreateWikiForm } from "@/components/wikis/CreateWikiForm";
import { db } from "@/db/client";
import { wikiBase } from "@/wiki/routes";
import { listWikis } from "@/wikis/wikis";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function WikiList() {
  await connection();
  const wikis = await listWikis(db());
  if (wikis.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <div className="text-center">
          <BookOpen className="mx-auto mb-4 size-10 text-muted" />
          <h1 className="text-2xl font-semibold tracking-tight">Create your first wiki</h1>
          <p className="mt-2 text-muted">
            A wiki groups the GitHub repositories of one project. The agent reads them together and writes one set of pages
            about the whole project. Name it, then add its repositories from the sidebar.
          </p>
        </div>
        <CreateWikiForm />
      </div>
    );
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Wikis</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Each wiki groups the repositories of one project.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {wikis.map((w) => (
            <li key={w.id}>
              <Link
                href={wikiBase(w.slug)}
                className="flex h-full flex-col gap-2 rounded-md border border-line bg-surface p-4 hover:border-accent"
              >
                <span className="flex items-center gap-2 font-medium">
                  <BookOpen className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 truncate">{w.name}</span>
                </span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <GitBranch className="size-3.5" /> {count(w.repoCount, "repository", "repositories")}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="size-3.5" /> {count(w.pageCount, "page", "pages")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <aside>
        <CreateWikiForm />
      </aside>
    </div>
  );
}

export default function WikisPage() {
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
          <WikiList />
        </Suspense>
      </div>
    </main>
  );
}
