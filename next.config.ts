import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Emits a self-contained server bundle so the Docker image does not need
  // node_modules. Harmless for Vercel, which ignores it.
  output: "standalone",
};

export default nextConfig;
