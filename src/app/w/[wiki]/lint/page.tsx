import { connection } from "next/server";
import Link from "next/link";
import { db } from "@/db/client";
import { findLintIssues, type LintFinding } from "@/wiki/lint";
import { wikiRoute } from "@/wiki/routes";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";

const LABELS: Record<LintFinding["kind"], { title: string; hint: string }> = {
  dead_link: { title: "Dead links", hint: "A wiki: link points to a page that no longer exists." },
  deleted_citation: { title: "Citations to deleted files", hint: "The cited file is gone from the latest sync." },
  stale: { title: "Stale pages", hint: "A cited file changed since the page was written." },
  no_citations: { title: "Pages without citations", hint: "Every claim should cite the code it describes." },
  orphan: { title: "Orphan pages", hint: "Nested pages that nothing links to." },
};

function detail(f: LintFinding) {
  if (f.kind === "dead_link") return <code className="font-mono text-xs">wiki:{f.target}</code>;
  if (f.kind === "deleted_citation") return <code className="font-mono text-xs">{f.repo}/{f.file}</code>;
  return null;
}

/** Computed live; the scheduled lint-wiki job writes the same findings to wiki_log. */
async function LintPageContent() {
  await connection();
  const findings = await findLintIssues(db());
  const groups = Object.keys(LABELS) as LintFinding["kind"][];
  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Lint</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Deterministic health checks over accepted pages.</p>
      {findings.length === 0 && (
        <p className="rounded-md border border-dashed border-line p-8 text-center text-sm text-muted">No findings.</p>
      )}
      {groups.map((kind) => {
        const items = findings.filter((f) => f.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className="mb-6">
            <h2 className="font-medium">
              {LABELS[kind].title} <span className="text-muted">({items.length})</span>
            </h2>
            <p className="mb-2 text-sm text-muted">{LABELS[kind].hint}</p>
            <ul className="divide-y divide-line rounded-md border border-line bg-surface">
              {items.map((f, i) => (
                <li key={`${f.pageId}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Link href={wikiRoute(f.path)} className="text-accent hover:underline">
                    {f.path}
                  </Link>
                  {detail(f)}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function LintPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <LintPageContent />
    </Suspense>
  );
}
