import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { pages } from "@/db/schema";

/** "Parent/Child" display paths for the given pages, walking `parent_id` up to the root. */
export async function pagePaths(db: Db, pageIds: string[]): Promise<Map<string, string>> {
  if (!pageIds.length) return new Map();
  const ids = sql.join(pageIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<{ hit: string; path: string }>(sql`
    with recursive up as (
      select p.id as hit, p.parent_id, p.title::text as path, 0 as depth
      from ${pages} p where p.id in (${ids})
      union all
      select up.hit, p.parent_id, p.title || '/' || up.path, up.depth + 1
      from up join ${pages} p on p.id = up.parent_id
      where up.depth < 64
    )
    select hit, path from up where parent_id is null`);
  return new Map(rows.map((r) => [r.hit, r.path]));
}

