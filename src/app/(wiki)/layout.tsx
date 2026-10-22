import { ChatPanel } from "@/components/chat/ChatPanel";
import { WikiSidebar } from "@/components/wiki/WikiSidebar";

/** Three panes: page tree (wiki track) · page (wiki track) · chat (agent track). */
export default function WikiLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid h-full grid-cols-[16rem_minmax(0,1fr)_24rem] max-lg:grid-cols-[minmax(0,1fr)]">
      <aside className="overflow-y-auto border-r border-line bg-surface-2 max-lg:hidden">
        <WikiSidebar />
      </aside>
      <main className="overflow-y-auto">{children}</main>
      <aside className="flex min-h-0 flex-col border-l border-line bg-surface max-lg:hidden">
        <ChatPanel />
      </aside>
    </div>
  );
}
