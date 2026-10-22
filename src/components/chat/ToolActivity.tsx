"use client";

import { getToolName } from "ai";
import { AlertTriangle, Loader2 } from "lucide-react";
import { WRITE_TOOL_NAMES } from "@/agent/tool-names";
import { Disclosure } from "@/components/ui/Disclosure";
import { ToolPart, type ToolUIPartOfWiki } from "./ToolPart";

const WRITES = new Set<string>(WRITE_TOOL_NAMES);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Searched 3× · read 1 page · 1 edit": what the agent did, without the step-by-step log. */
export function summarizeActivity(parts: ToolUIPartOfWiki[]): string {
  let searches = 0, reads = 0, edits = 0, other = 0;
  for (const p of parts) {
    const name = getToolName(p);
    if (name === "searchKnowledge") searches++;
    else if (name === "readPage") reads++;
    else if (WRITES.has(name)) edits++;
    else other++;
  }
  return [
    searches && `Searched ${searches}×`,
    reads && `read ${plural(reads, "page")}`,
    edits && plural(edits, "edit"),
    other && plural(other, "step"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One collapsed line per answer; open it to see every step. */
export function ToolActivity({
  parts,
  onRespond,
}: {
  parts: ToolUIPartOfWiki[];
  onRespond: (approvalId: string, approved: boolean) => void;
}) {
  if (parts.length === 0) return null;
  const running = parts.some((p) => p.state === "input-streaming" || p.state === "input-available");
  const failed = parts.filter((p) => p.state === "output-error").length;
  return (
    <Disclosure
      className="mb-2"
      summary={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{summarizeActivity(parts)}</span>
          {running && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-label="working" />}
          {failed > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-danger">
              <AlertTriangle className="size-3.5" aria-hidden /> {failed} failed
            </span>
          )}
        </span>
      }
    >
      <div className="border-l border-line pl-2">
        {parts.map((part) => (
          <ToolPart key={part.toolCallId} part={part} onRespond={onRespond} />
        ))}
      </div>
    </Disclosure>
  );
}
