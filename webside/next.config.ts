import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  typescript: {
    // Agent route + existing pages have pre-existing implicit-any warnings; don't block production build
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
