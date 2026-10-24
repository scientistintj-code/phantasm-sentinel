import type { Metadata } from "next";

import { Topbar } from "@/components/Topbar";

import "./globals.css";

const description = "Forensic console for unmasking dynamic cyber-scam infrastructure.";

export const metadata: Metadata = {
  title: {
    default: "Phantasm Sentinel",
    template: "%s · Phantasm Sentinel",
  },
  description,
  applicationName: "Phantasm Sentinel",
  openGraph: {
    description,
    siteName: "Phantasm Sentinel",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="app-shell">
          <Topbar />
          <div id="main" tabIndex={-1}>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
