import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The server binds 127.0.0.1; either local address must still hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  partialPrefetching: true,
  // Pre-multi-wiki URLs land in the wiki the migration created for existing installs. Query strings carry over.
  async redirects() {
    const to = (path: string) => `/w/default${path}`;
    return [
      { source: "/wiki/:path*", destination: to("/wiki/:path*"), permanent: false },
      { source: "/history/:path*", destination: to("/history/:path*"), permanent: false },
      { source: "/page/:id", destination: to("/page/:id"), permanent: false },
      ...["/proposals", "/jobs", "/pipeline", "/lint", "/explain"].map((p) => ({ source: p, destination: to(p), permanent: false })),
      { source: "/project", destination: to("/settings"), permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
