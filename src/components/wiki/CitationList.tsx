import { ExternalLink } from "lucide-react";
import type { Citation } from "@/core/contracts";
import { githubBlobUrl } from "@/lib/source-links";

function label(c: Citation) {
  const lines = c.startLine ? `#L${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-L${c.endLine}` : ""}` : "";
  return `${c.path}${lines}`;
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return <p className="text-sm text-muted">No citations.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {citations.map((c) => (
        <li key={`${c.repo}/${label(c)}@${c.commitSha}`} className="flex min-w-0 items-center gap-2">
          <a
            href={githubBlobUrl(c)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-mono text-xs">{label(c)}</span>
          </a>
          <span className="shrink-0 font-mono text-xs text-muted">
            {c.repo}@{c.commitSha.slice(0, 7)}
          </span>
        </li>
      ))}
    </ul>
  );
}
