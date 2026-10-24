import type { Metadata } from "next";
import {
  Barlow_Condensed,
  Fraunces,
  IBM_Plex_Mono,
  Newsreader,
  Nunito,
  Source_Sans_3,
} from "next/font/google";

import { Overlays } from "@/components/overlays";
import { LabProvider } from "@/components/lab-state";
import { SiteFrame } from "@/components/site-frame";
import { getCurrentStorefront } from "@/lib/storefronts";

import "./globals.css";

const fontA = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-a",
});

const fontBDisplay = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
  variable: "--font-b-display",
});

const fontBBody = Source_Sans_3({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-b-body",
});

const fontC = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-c",
});

const fontD = Nunito({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-d",
});

const fontE = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-e",
});

const fontClassByStore = {
  a: fontA.variable,
  b: `${fontBDisplay.variable} ${fontBBody.variable}`,
  c: fontC.variable,
  d: fontD.variable,
  e: fontE.variable,
} as const;

export function generateMetadata(): Metadata {
  const store = getCurrentStorefront();
  return {
    title: store.name,
    description: store.tagline,
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = getCurrentStorefront();
  return (
    <html
      lang="en"
      data-store={store.id}
      data-layout={store.layout}
      className={fontClassByStore[store.id]}
    >
      <body>
        <LabProvider storeId={store.id}>
          <SiteFrame
            name={store.name}
            kicker={store.kicker}
            tagline={store.tagline}
            contact={store.contact}
          >
            {children}
          </SiteFrame>
          <Overlays shopName={store.name} overlay={store.overlay} />
        </LabProvider>
      </body>
    </html>
  );
}
