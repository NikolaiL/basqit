"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LoadingBars } from "~~/components/LoadingBars";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton";

const pages = [
  { href: "/discover", label: "Discover", color: "#8b5cf6" },
  { href: "/portfolio", label: "Portfolio", color: "#3b82f6" },
  { href: "/baskets", label: "Baskets", color: "#ec4899" },
  { href: "/gifts", label: "Gifts", color: "#f97316" },
  { href: "/packs", label: "Packs", color: "#16a34a" },
];

function MenuLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="relative inline-flex items-center justify-center" aria-busy={pending}>
      <span className={pending ? "invisible" : ""}>{label}</span>
      {pending && (
        <span
          className="absolute inset-0 flex items-center justify-center"
          role="status"
          aria-label={`Loading ${label}`}
        >
          <LoadingBars small />
        </span>
      )}
    </span>
  );
}

export const Header = () => {
  const pathname = usePathname();
  return (
    <header className="bq-header">
      <div className="bq-header-inner">
        <Link href="/" className="bq-brand" aria-label="Basqit home">
          {/* Wordmark and basket in one SVG, text in outlines, so it renders the same everywhere. */}
          <Image className="bq-brand-light" src="/basqit-logo.svg" width={135} height={34} alt="" priority />
          <Image className="bq-brand-dark" src="/basqit-logo-dark.svg" width={135} height={34} alt="" priority />
        </Link>
        <nav aria-label="Main navigation" className="bq-nav">
          {pages.map(page => (
            <Link
              key={page.href}
              href={page.href}
              className="bq-nav-chip"
              aria-label={page.label}
              style={{ "--chip": page.color } as CSSProperties}
              aria-current={pathname === page.href ? "page" : undefined}
            >
              <MenuLabel label={page.label} />
            </Link>
          ))}
        </nav>
        <div className="bq-header-wallet">
          <RainbowKitCustomConnectButton />
        </div>
        <SwitchTheme />
      </div>
    </header>
  );
};
