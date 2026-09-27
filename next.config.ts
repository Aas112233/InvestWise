import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // postgres/bcryptjs stay external: bundling the DB driver into every
  // serverless function inflates cold starts (DATA-025).
  serverExternalPackages: ['postgres', 'bcryptjs'],
  experimental: {
    // lucide-react + recharts ship per-module code; barrel imports without
    // this optimization bloat the client bundle.
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  webpack(config) {
    // drizzle schema files use ESM-style `.js` suffixes for `.ts` sources;
    // teach webpack the same mapping TypeScript already applies.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
