import type { NextConfig } from "next";

// The canonical production host. Every other hostname that reaches the
// project keeps serving, but only as a redirect: mutations are origin-checked
// against APP_ORIGIN, so a second working hostname would half-work.
const CANONICAL_HOST = "openmarket.systems";
const LEGACY_HOSTS = [
  "www.openmarket.systems",
  "openmkt.vercel.app",
  "openmarket-rho-three.vercel.app",
];
const TAPE_ORIGIN = "https://tape-nick-21c4.vercel.app";

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  // The Positioning Tape (github.com/nickadesina/tape) is its own Vercel
  // project, built with basePath /tape so every asset path survives the proxy.
  rewrites() {
    return Promise.resolve([
      {
        source: "/tape/:path*",
        destination: `${TAPE_ORIGIN}/tape/:path*`,
      },
    ]);
  },
  redirects() {
    return Promise.resolve(
      LEGACY_HOSTS.map((host) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value: host }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      })),
    );
  },
};

export default nextConfig;
