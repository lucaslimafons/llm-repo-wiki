import { Bot, User } from "lucide-react";
import type { RevisionSummary } from "@/core/contracts";

const STATUS_CLASS: Record<RevisionSummary["status"], string> = {
  accepted: "text-success",
  proposed: "text-accent",
  rejected: "text-danger",
};

export function RevisionMeta({ rev }: { rev: RevisionSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
      {rev.authorKind === "agent" ? <Bot className="size-3.5 shrink-0" aria-label="Agent" /> : <User className="size-3.5 shrink-0" aria-label="Human" />}
      <span className={STATUS_CLASS[rev.status]}>{rev.status}</span>
      <span>{rev.createdAt.slice(0, 16).replace("T", " ")} UTC</span>
      <span className="font-mono">{rev.id.slice(0, 8)}</span>
    </span>
  );
}
