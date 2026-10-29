/** App routes for a page's display path; each title is one URL segment (titles never contain "/"). */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Every wiki route lives under /w/<slug>; API routes under /api/w/<slug>. */
export const wikiBase = (slug: string) => `/w/${encodeURIComponent(slug)}`;
export const apiBase = (slug: string) => `/api/w/${encodeURIComponent(slug)}`;

export const wikiRoute = (slug: string, path: string) => `${wikiBase(slug)}/wiki/${encodePath(path)}`;
export const historyRoute = (slug: string, path: string) => `${wikiBase(slug)}/history/${encodePath(path)}`;
