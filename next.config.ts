import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits on top of the map legend; errors still surface.
  devIndicators: false,
  // Friendly names for the four places; query strings are kept, so deep links still work.
  async redirects() {
    return [
      { source: "/switchboard", destination: "/home", permanent: false },
      { source: "/crosswire", destination: "/compare", permanent: false },
      { source: "/stormline", destination: "/storm", permanent: false },
      { source: "/ledger", destination: "/data", permanent: false },
    ];
  },
  // Docker builds set NEXT_OUTPUT=standalone; `next start` (App Platform) uses the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
