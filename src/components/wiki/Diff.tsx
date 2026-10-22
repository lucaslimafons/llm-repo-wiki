"use client";

import dynamic from "next/dynamic";
import { usePrefersDark } from "./useColorScheme";

// Client-only: the viewer measures the DOM and pulls in its own styling runtime.
const DiffViewer = dynamic(() => import("react-diff-viewer-continued"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted">Loading diff…</p>,
});

export function Diff({ oldValue, newValue, oldTitle, newTitle }: { oldValue: string; newValue: string; oldTitle?: string; newTitle?: string }) {
  const dark = usePrefersDark();
  return (
    <div className="overflow-x-auto rounded-md border border-line text-xs">
      <DiffViewer
        oldValue={oldValue}
        newValue={newValue}
        splitView={false}
        useDarkTheme={dark}
        leftTitle={oldTitle}
        rightTitle={newTitle}
      />
    </div>
  );
}
