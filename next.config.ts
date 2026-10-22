import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Local-only app: opening it as 127.0.0.1 instead of localhost must still hydrate.
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
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
