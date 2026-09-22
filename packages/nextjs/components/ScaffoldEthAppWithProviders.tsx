"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { WagmiProvider } from "wagmi";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { MiniappProvider } from "~~/components/MiniappProvider";
import { WalletAuthentication } from "~~/components/WalletAuthentication";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { ScaffoldToaster } from "~~/components/scaffold-eth/ScaffoldToaster";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  const discover = usePathname() === "/discover";
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!discover) return;
    const viewport = window.visualViewport;
    const update = () => {
      if (!shell.current) return;
      shell.current.style.setProperty("--discover-height", `${viewport?.height ?? window.innerHeight}px`);
      shell.current.style.setProperty("--discover-top", `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [discover]);
  return (
    <>
      <div ref={shell} className={discover ? "bq-discover-shell" : "flex flex-col min-h-screen"}>
        <Header />
        <div className="relative flex flex-col flex-1 min-h-0">{children}</div>
        {!discover && <Footer />}
      </div>
      <ScaffoldToaster />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MiniappProvider>
          <WalletAuthentication>
            <RainbowKitProvider
              avatar={BlockieAvatar}
              theme={
                mounted
                  ? isDarkMode
                    ? darkTheme({ accentColor: "#5A4FE0", accentColorForeground: "white", borderRadius: "medium" })
                    : lightTheme({ accentColor: "#5A4FE0", accentColorForeground: "white", borderRadius: "medium" })
                  : lightTheme({ accentColor: "#5A4FE0", accentColorForeground: "white", borderRadius: "medium" })
              }
            >
              <ProgressBar height="3px" color="#5A4FE0" />
              <ScaffoldEthApp>{children}</ScaffoldEthApp>
            </RainbowKitProvider>
          </WalletAuthentication>
        </MiniappProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
