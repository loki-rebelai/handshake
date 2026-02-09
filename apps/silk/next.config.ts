import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@silkyway/sdk'],
  turbopack: {},
};

export default nextConfig;
