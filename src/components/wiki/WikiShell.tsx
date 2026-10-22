"use client";

import { useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const STORAGE_KEY = "llm-repo-wiki:chat-width";
export const CHAT_WIDTH = { default: 448, min: 320, max: 960, step: 32 } as const;

const clamp = (w: number) => Math.round(Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min, w)));

// A per-viewer convenience, so storage can be blocked or empty: every access falls back to the default.
const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return stored ? clamp(stored) : CHAT_WIDTH.default;
  } catch {
    return CHAT_WIDTH.default;
  }
}
function saveWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamp(width)));
  } catch {
    // Storage blocked (private window): the width just isn't remembered.
  }
  listeners.forEach((l) => l());
}

/** Three panes: page tree · page · chat. The chat column is resizable by drag or keyboard and remembered. */
export function WikiShell({ sidebar, chat, children }: { sidebar: ReactNode; chat: ReactNode; children: ReactNode }) {
  const stored = useSyncExternalStore(subscribe, readWidth, () => CHAT_WIDTH.default);
  const [dragging, setDragging] = useState<number | null>(null);
  const width = dragging ?? stored;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(width);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging !== null) setDragging(clamp(window.innerWidth - e.clientX));
  };
  const onPointerUp = () => {
    if (dragging !== null) saveWidth(dragging);
    setDragging(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === "ArrowLeft" ? width + CHAT_WIDTH.step
      : e.key === "ArrowRight" ? width - CHAT_WIDTH.step
      : e.key === "Home" ? CHAT_WIDTH.max
      : e.key === "End" ? CHAT_WIDTH.min
      : null;
    if (next === null) return;
    e.preventDefault();
    saveWidth(next);
  };

  return (
    <div
      className={`grid h-full grid-cols-[16rem_minmax(0,1fr)_var(--chat-w)] max-lg:grid-cols-[minmax(0,1fr)] ${dragging !== null ? "cursor-col-resize select-none" : ""}`}
      style={{ "--chat-w": `${width}px` } as CSSProperties}
    >
      <aside className="overflow-y-auto border-r border-line bg-surface-2 max-lg:hidden">{sidebar}</aside>
      <main className="overflow-y-auto">{children}</main>
      <aside className="relative flex min-h-0 flex-col border-l border-line bg-surface max-lg:hidden">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          aria-valuenow={width}
          aria-valuemin={CHAT_WIDTH.min}
          aria-valuemax={CHAT_WIDTH.max}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => saveWidth(CHAT_WIDTH.default)}
          onKeyDown={onKeyDown}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-accent/30 focus-visible:bg-accent/40"
        />
        {chat}
      </aside>
    </div>
  );
}
