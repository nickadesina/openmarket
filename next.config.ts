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

// v1's pages (the dealer's markets, the tournament, the portfolio and the
// admin screens), archived at the tags archive/dealer-v1 and
// archive/tournament-v1, and served read-only by the archive deployment (the
// Vercel project openmarket-v1, branch archive/v1-site), so an old link opens
// the page it named. Temporary: v2 may reuse a path.
const V1_PATHS = ["/m", "/t", "/portfolio", "/admin", "/for-policy"];
const V1_ARCHIVE_ORIGIN = "https://v1.openmarket.systems";

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  redirects() {
    return Promise.resolve([
      ...LEGACY_HOSTS.map((host) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value: host }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      })),
      // The bare path and its subpaths are separate rules: one `/:path*` rule
      // sends a bare `/m` to `/m/`, which costs the archive a slash redirect.
      ...V1_PATHS.flatMap((path) => [
        { source: path, destination: `${V1_ARCHIVE_ORIGIN}${path}`, permanent: false },
        {
          source: `${path}/:path+`,
          destination: `${V1_ARCHIVE_ORIGIN}${path}/:path+`,
          permanent: false,
        },
      ]),
      { source: "/ref/trial", destination: "/ref", permanent: false },
    ]);
  },
};

export default nextConfig;
