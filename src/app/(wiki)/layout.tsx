import { ChatPanel } from "@/components/chat/ChatPanel";
import { WikiShell } from "@/components/wiki/WikiShell";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";

export default function WikiLayout({ children }: LayoutProps<"/">) {
  return (
    <WikiShell sidebar={<WikiSidebar />} chat={<ChatPanel />}>
      {children}
    </WikiShell>
  );
}
