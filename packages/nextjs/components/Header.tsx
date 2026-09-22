"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton";

export const Header = () => {
  const pathname = usePathname();
  return (
    <header className="bq-header">
      <div className="bq-header-inner">
        <Link href="/" className="bq-brand">
          <Image src="/basqit-icon.svg" width={38} height={38} alt="" />
          <span>
            basqit<span className="bq-brand-period">.</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="bq-nav">
          <Link
            className={pathname === "/" ? "bq-nav-active" : ""}
            aria-current={pathname === "/" ? "page" : undefined}
            href="/"
          >
            Portfolio
          </Link>
          <Link
            className={pathname === "/atlas" ? "bq-nav-active" : ""}
            aria-current={pathname === "/atlas" ? "page" : undefined}
            href="/atlas"
          >
            Assets
          </Link>
          <Link
            href="/discover"
            className={pathname === "/discover" ? "bq-nav-active" : ""}
            aria-current={pathname === "/discover" ? "page" : undefined}
          >
            Discover
          </Link>
          <Link
            className={pathname === "/corporate-events" ? "bq-nav-active" : ""}
            aria-current={pathname === "/corporate-events" ? "page" : undefined}
            href="/corporate-events"
          >
            Corporate events
          </Link>
        </nav>
        <div className="bq-header-wallet">
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    </header>
  );
};
