import { ReposPanel } from "@/components/repos/ReposPanel";

/** Placeholder: owned by the wiki track (page tree). ReposPanel belongs to the ingest track. */
export function WikiSidebar() {
  return (
    <div className="flex flex-col">
      <nav className="p-4 text-sm text-muted">Pages</nav>
      <ReposPanel />
    </div>
  );
}
