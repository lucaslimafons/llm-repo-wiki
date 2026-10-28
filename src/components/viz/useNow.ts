"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 100;
let now = Date.now();

function subscribe(onChange: () => void) {
  const id = setInterval(() => {
    now = Date.now();
    onChange();
  }, TICK_MS);
  return () => clearInterval(id);
}
const noop = () => () => {};

/** A clock that ticks only while `active` (replay playing); unsubscribing stops the interval. */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : noop, () => now, () => 0);
}
