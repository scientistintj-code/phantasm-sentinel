import type { Metadata } from "next";

import { Topbar } from "@/components/Topbar";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Phantasm Sentinel",
    template: "%s · Phantasm Sentinel",
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
        <div className="app-shell">
          <Topbar />
          {children}
        </div>
      </body>
    </html>
  );
}
