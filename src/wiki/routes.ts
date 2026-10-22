/** App routes for a page's display path; each title is one URL segment (titles never contain "/"). */
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const wikiRoute = (path: string) => `/wiki/${encodePath(path)}`;
export const historyRoute = (path: string) => `/history/${encodePath(path)}`;
