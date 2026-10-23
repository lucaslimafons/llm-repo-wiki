/** "Ingest pipeline: v2 (Ünïcode)" → "ingest-pipeline-v2-unicode". Readable on GitHub, safe on any disk. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug || "page";
}

/**
 * One slug per sibling, in order; a clash gets "-2", "-3". "readme" is reserved because a page
 * slugged that would collide with its folder's README.md on a case-insensitive disk.
 */
export function uniqueSlugs(titles: string[]): string[] {
  const used = new Set(["readme"]);
  return titles.map((title) => {
    const base = slugify(title);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  });
}
