/** Suspense fallback for wiki routes: URL and database reads stream in behind it. */
export function PageFallback() {
  return <p className="p-8 text-sm text-muted">Loading…</p>;
}
