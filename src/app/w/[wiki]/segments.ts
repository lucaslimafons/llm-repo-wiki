/** Catch-all params → display path. Next hands segments over percent-encoded, one title each. */
export function pathFromSegments(segments: string[]): string {
  return segments
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}
