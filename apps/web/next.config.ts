import type { NextConfig } from "next";

const config: NextConfig = {
  // @ttmc/core ships compiled ESM from the workspace; transpiling it keeps
  // `next dev` working without a separate watch build running alongside.
  transpilePackages: ["@ttmc/core"],
  serverExternalPackages: ["postgres"],
  experimental: {
    typedRoutes: true,
  },
};

export default config;
