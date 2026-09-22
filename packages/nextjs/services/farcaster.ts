export function farcasterOrigin() {
  return new URL(
    process.env.NEXT_PUBLIC_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
      "https://basqit.vercel.app",
  ).origin;
}

export function miniappEmbed(origin: string, imagePath = "/discover/og/farcaster?v=1", launchPath?: string) {
  const image = new URL(imagePath, origin);
  // Farcaster caps image URLs at 1024 characters, including encoded Unicode.
  const theme = [...(image.searchParams.get("theme") || "")];
  while (image.href.length > 1024 && theme.length) {
    theme.pop();
    image.searchParams.set("theme", theme.join(""));
  }
  const launchUrl = launchPath ? new URL(launchPath, origin).href : undefined;
  return JSON.stringify({
    version: "1",
    imageUrl: image.href,
    button: {
      title: "Find your stock mood",
      action: {
        type: "launch_miniapp",
        name: "Basqit",
        // Omitting the URL launches the shared page with its full query intact.
        ...(launchUrl && launchUrl.length <= 1024 ? { url: launchUrl } : {}),
        splashImageUrl: `${origin}/farcaster/splash.png`,
        splashBackgroundColor: "#f4f5fa",
      },
    },
  });
}

export function farcasterManifest() {
  const origin = farcasterOrigin();
  const header = process.env.FARCASTER_HEADER?.trim();
  const payload = process.env.FARCASTER_PAYLOAD?.trim();
  const signature = process.env.FARCASTER_SIGNATURE?.trim();
  let accountAssociation;
  if (header && payload && signature) {
    try {
      const domain = JSON.parse(Buffer.from(payload, "base64url").toString()).domain;
      if (domain === new URL(origin).hostname) accountAssociation = { header, payload, signature };
    } catch {
      // Incomplete or mismatched configuration must not publish a false association.
    }
  }
  return {
    // Temporary setup values; the signed domain association comes from the environment.
    accountAssociation: accountAssociation ?? { header: "header", payload: "payload", signature: "signature" },
    miniapp: {
      version: "1",
      name: "Basqit",
      subtitle: "Find your stock mood",
      description:
        "Discover stock tokens by idea or theme. Explore your selections and view your portfolio on Robinhood Chain.",
      iconUrl: `${origin}/farcaster/icon.png`,
      homeUrl: `${origin}/discover`,
      splashImageUrl: `${origin}/farcaster/splash.png`,
      splashBackgroundColor: "#f4f5fa",
      primaryCategory: "finance",
      tags: ["stocks", "discovery", "portfolio"],
      heroImageUrl: `${origin}/thumbnail.jpg`,
      tagline: "Find your stock mood",
      ogTitle: "Basqit",
      ogDescription: "Turn an idea into a stock selection. Find your stock mood with Basqit.",
      ogImageUrl: `${origin}/thumbnail.jpg`,
    },
  };
}
