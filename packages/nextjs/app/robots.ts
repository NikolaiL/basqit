import type { MetadataRoute } from "next";
import { baseUrl } from "~~/utils/scaffold-eth/getMetadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/debug", "/blockexplorer", "/confetti-test"] },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
