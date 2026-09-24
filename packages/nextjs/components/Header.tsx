"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton";

const pages = [
  { href: "/discover", label: "Discover" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/atlas", label: "Assets" },
  { href: "/corporate-events", label: "Corporate events" },
];

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
              className={pathname === page.href ? "bq-nav-active" : ""}
              aria-current={pathname === page.href ? "page" : undefined}
            >
              {page.label}
            </Link>
          ))}
        </nav>
        <details className="dropdown dropdown-end bq-mobile-menu">
          <summary className="btn btn-ghost btn-square" aria-label="Open navigation menu">
            ☰
          </summary>
          <div className="dropdown-content menu bg-base-100 rounded-box shadow-lg">
            <nav
              aria-label="Mobile navigation"
              onClick={event => {
                if ((event.target as HTMLElement).closest("a"))
                  event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {pages.map(page => (
                <Link key={page.href} href={page.href} aria-current={pathname === page.href ? "page" : undefined}>
                  {page.label}
                </Link>
              ))}
            </nav>
            <SwitchTheme />
          </div>
        </details>
        <div className="bq-header-wallet">
          <RainbowKitCustomConnectButton />
        </div>
        <SwitchTheme />
      </div>
    </header>
  );
};
