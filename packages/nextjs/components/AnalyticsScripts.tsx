"use client";

import Script from "next/script";
import { GA_ID, initializeAnalytics } from "~~/services/analytics/events";

export function AnalyticsScripts() {
  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      strategy="afterInteractive"
      onReady={initializeAnalytics}
    />
  );
}
