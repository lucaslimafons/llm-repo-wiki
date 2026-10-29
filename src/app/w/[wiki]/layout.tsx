import { Suspense } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { WikiProvider } from "@/components/wikis/WikiContext";
import { WikiShell } from "@/components/wiki/WikiShell";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";
import { requireWiki } from "@/wikis/server";
import { PageFallback } from "./fallback";

async function WikiFrame({ params, children }: LayoutProps<"/w/[wiki]">) {
  const { id, slug, name } = await requireWiki((await params).wiki);
  const wiki = { id, slug, name };
  return (
    <WikiProvider wiki={wiki}>
      <WikiShell sidebar={<WikiSidebar wiki={wiki} />} chat={<ChatPanel />}>
        {children}
      </WikiShell>
    </WikiProvider>
  );
}

// The slug is request data, so under cacheComponents it is read behind a Suspense boundary.
export default function WikiLayout(props: LayoutProps<"/w/[wiki]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <WikiFrame {...props} />
    </Suspense>
  );
}
