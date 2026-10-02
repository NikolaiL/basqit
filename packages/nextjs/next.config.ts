import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.BASQIT_DEV_ORIGINS?.split(",").filter(Boolean),
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/og/farcaster": ["./public/thumbnail.jpg"],
    "/discover/og{,/**}": ["./public/stock-logos/*.png", "./public/stock-logos/*.svg", "./public/og/stock-field-*.png"],
  },
  devIndicators: false,
  // The discover pile loads every logo at once; without this each visit revalidates all of them. Not immutable:
  // file names stay the same when a logo is replaced.
  async headers() {
    return [
      {
        source: "/stock-logos/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";

if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  // Static export has no server to send headers, and Next warns if they are set.
  delete nextConfig.headers;
  nextConfig.images = {
    unoptimized: true,
  };
}

module.exports = nextConfig;
