import type { NextConfig } from "next";

// The canonical production host. The auto-generated Vercel hostname keeps
// serving, but only as a redirect: mutations are origin-checked against
// APP_ORIGIN, so a second working hostname would half-work.
const CANONICAL_HOST = "openmkt.vercel.app";
const LEGACY_HOSTS = ["openmarket-rho-three.vercel.app"];

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
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
