import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Docker builds set NEXT_OUTPUT=standalone; `next start` (App Platform) uses the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
