import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
