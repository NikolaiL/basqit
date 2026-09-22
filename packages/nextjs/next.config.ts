import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["rhh.ngrok.dev", "basqit.ngrok.dev"],
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/og/farcaster": ["./public/thumbnail.jpg"],
    "/discover/og{,/**}": ["./public/stock-logos/*.png", "./public/stock-logos/*.svg", "./public/og/stock-field-*.png"],
  },
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";

if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = {
    unoptimized: true,
  };
}

module.exports = nextConfig;
