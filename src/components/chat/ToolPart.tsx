"use client";

import { getToolName, type ToolUIPart, type DynamicToolUIPart } from "ai";
import { AlertTriangle, ArrowRightLeft, Ban, Check, FilePlus, FileText, ListTree, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SearchToolOutput, WikiTools } from "@/agent/tools";
import type { InferUITools } from "ai";
import { PageDiff } from "./PageDiff";

export type ToolUIPartOfWiki = ToolUIPart<InferUITools<WikiTools>> | DynamicToolUIPart;
type Part = ToolUIPartOfWiki;
type Input = Record<string, unknown> | undefined;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function describe(name: string, input: Input, output: unknown): { icon: ReactNode; label: string } {
  switch (name) {
    case "searchKnowledge": {
      const hits = (output as SearchToolOutput | undefined)?.hits?.length;
      return { icon: <Search className="size-3.5" />, label: `Searched: ${str(input?.query)}${hits === undefined ? "" : ` (${hits})`}` };
    }
    case "listTree":
      return { icon: <ListTree className="size-3.5" />, label: "Listed the wiki pages" };
    case "readPage":
      return { icon: <FileText className="size-3.5" />, label: `Read ${str(input?.path)}` };
    case "createPage": {
      const path = [str(input?.parentPath), str(input?.title)].filter(Boolean).join("/");
      return { icon: <FilePlus className="size-3.5" />, label: `Create ${path}` };
    }
    case "updatePage":
      return { icon: <Pencil className="size-3.5" />, label: `Update ${str(input?.path)}` };
    case "movePage":
      return { icon: <ArrowRightLeft className="size-3.5" />, label: `Move ${str(input?.path)} → ${str(input?.newParentPath) || "top level"}` };
    case "deletePage":
      return { icon: <Trash2 className="size-3.5" />, label: `Delete ${str(input?.path)}` };
    default:
      return { icon: <FileText className="size-3.5" />, label: name };
  }
}

export function ToolPart({
  part,
  onRespond,
}: {
  part: Part;
  onRespond: (approvalId: string, approved: boolean) => void;
}) {
  const name = getToolName(part);
  const input = part.input as Input;
  const { icon, label } = describe(name, input, part.state === "output-available" ? part.output : undefined);

  if (part.state === "approval-requested" && !part.approval.isAutomatic) {
    return (
      <div className="my-2 rounded-md border border-line bg-surface-2 p-2 text-sm">
        <p className="flex items-center gap-1.5 font-medium">
          {icon}
          <span className="min-w-0 break-words">{label}?</span>
        </p>
        {str(input?.reason) && <p className="mt-1 text-xs text-muted">{str(input?.reason)}</p>}
        {name === "updatePage" && (
          <div className="mt-2">
            <PageDiff path={str(input?.path)} newBody={str(input?.bodyMd)} baseRevision={str(input?.baseRevision)} />
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onRespond(part.approval.id, true)}
            className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"
          >
            <Check className="size-3.5" /> Approve
          </button>
          <button
            type="button"
            onClick={() => onRespond(part.approval.id, false)}
            className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs"
          >
            <X className="size-3.5" /> Deny
          </button>
        </div>
      </div>
    );
  }

  const status =
    part.state === "output-error" ? (
      <span className="flex items-center gap-1 text-danger">
        <AlertTriangle className="size-3.5" /> {part.errorText}
      </span>
    ) : part.state === "output-denied" || (part.state === "approval-responded" && !part.approval.approved) ? (
      <span className="flex items-center gap-1">
        <Ban className="size-3.5" /> denied
      </span>
    ) : part.state === "output-available" ? null : (
      <Loader2 className="size-3.5 animate-spin" />
    );

  return (
    <div className="my-1 flex min-w-0 items-start gap-1.5 text-xs text-muted">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {name === "searchKnowledge" && part.state === "output-available" && str(input?.query) && (
        <Link href={`/explain?q=${encodeURIComponent(str(input?.query))}`} className="shrink-0 text-accent hover:underline">
          How was this found?
        </Link>
      )}
      {status && <span className="shrink-0">{status}</span>}
    </div>
  );
}

/** Waiting on the user: these stay inline and expanded, never folded into the activity group. */
export function needsApproval(part: Part): boolean {
  return part.state === "approval-requested" && !part.approval.isAutomatic;
}
