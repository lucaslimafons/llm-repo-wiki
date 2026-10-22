import { ExternalLink, FileText } from "lucide-react";
import type { WikiUIMessage } from "@/agent/tools";

type SourcePart = Extract<WikiUIMessage["parts"][number], { type: "source-url" }>;

/** Numbered in first-seen order; GitHub permalinks open in a new tab, wiki pages in place. */
export function SourcesList({ sources }: { sources: SourcePart[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="mb-1 text-xs font-medium text-muted">Sources</p>
      <ol className="space-y-0.5 text-xs">
        {sources.map((s, i) => {
          const external = /^https?:\/\//.test(s.url);
          return (
            <li key={s.sourceId} className="flex min-w-0 items-start gap-1.5">
              <span className="shrink-0 tabular-nums text-muted">{i + 1}.</span>
              <a
                href={s.url}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex min-w-0 items-center gap-1 text-accent hover:underline"
                title={s.title ?? s.url}
              >
                {external ? <ExternalLink className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
                <span className="truncate font-mono">{s.title ?? s.url}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
