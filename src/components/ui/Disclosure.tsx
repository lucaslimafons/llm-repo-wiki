import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Native <details>: keyboard and screen-reader accessible, no state, works in server components.
 * Named group so a disclosure nested in another only rotates its own chevron.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={`group/disclosure min-w-0 ${className}`}>
      <summary className="flex cursor-pointer list-none select-none items-center gap-1 text-xs font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/disclosure:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-1.5 min-w-0">{children}</div>
    </details>
  );
}
