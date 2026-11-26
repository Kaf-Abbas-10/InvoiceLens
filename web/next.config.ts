import type { NextConfig } from "next";

// The browser only talks to Next.js. proxy.ts forwards /api/* (and the API docs) to the Python
// engine (INVOICELENS_API_URL, default http://127.0.0.1:8200), so there are no CORS issues.
const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    proxyTimeout: 180_000,
    proxyClientMaxBodySize: "22mb", // the engine accepts invoices up to 20 MB
  },
};

export default nextConfig;
