"use client";

import { useCallback, useId, useState } from "react";

type MermaidApi = typeof import("mermaid").default;
let loading: Promise<MermaidApi> | undefined;

/** Loaded on first diagram only (~1MB), with `strict` so labels can't carry HTML or script. */
function loadMermaid(): Promise<MermaidApi> {
  loading ??= import("mermaid").then(({ default: mermaid }) => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
    return mermaid;
  });
  return loading;
}

export function Mermaid({ chart }: { chart: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<"loading" | "done" | { error: string }>("loading");

  // A ref callback, not an effect: it runs when the node mounts and cleans up when it leaves.
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      let live = true;
      loadMermaid()
        .then((m) => m.render(id, chart))
        .then(({ svg }) => {
          if (!live) return;
          node.innerHTML = svg; // mermaid's own DOMPurify output under securityLevel: strict
          setState("done");
        })
        .catch((err: unknown) => live && setState({ error: err instanceof Error ? err.message : String(err) }));
      return () => {
        live = false;
      };
    },
    [chart, id],
  );

  return (
    <figure className="my-4 overflow-x-auto rounded-md border border-line bg-surface p-4">
      <div ref={ref} className="flex justify-center" />
      {state !== "done" && (
        <pre className="m-0! border-0! bg-transparent! p-0! text-xs text-muted">
          {typeof state === "object" ? `Diagram error: ${state.error}\n\n${chart}` : chart}
        </pre>
      )}
    </figure>
  );
}
