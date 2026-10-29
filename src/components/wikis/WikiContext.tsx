"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WikiRef } from "@/wikis/schema";

const WikiContext = createContext<WikiRef | null>(null);

/** Set once by the /w/[wiki] layout; every client component under it reads the current wiki here. */
export function WikiProvider({ wiki, children }: { wiki: WikiRef; children: ReactNode }) {
  return <WikiContext.Provider value={wiki}>{children}</WikiContext.Provider>;
}

export function useWiki(): WikiRef {
  const wiki = useContext(WikiContext);
  if (!wiki) throw new Error("useWiki() outside a /w/[wiki] layout");
  return wiki;
}
