import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is required for the production Dockerfile: it traces
  // and copies only the runtime dependencies the server actually needs.
  output: "standalone",
};

export default nextConfig;
