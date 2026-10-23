import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The server binds 127.0.0.1; either local address must still hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
