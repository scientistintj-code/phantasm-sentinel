"use client";

import { Scan } from "lucide-react";
import { usePathname } from "next/navigation";

import { StatusPill } from "./StatusPill";

const LINKS = [
  { href: "/cases", label: "Cases" },
  { href: "/console", label: "Console" },
  { href: "/methodology", label: "Methodology" },
  { href: "/system", label: "System" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/console") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Topbar() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Scan aria-hidden="true" size={20} strokeWidth={1.5} />
        </div>
        <div>
          <strong>
            PHANTASM-<span>WEB</span>
          </strong>
          <small>Unmasking Dynamic Cyber-Scam Infrastructure</small>
        </div>
      </div>
      <div className="top-meta">
        <nav className="top-nav" aria-label="Primary">
          {LINKS.map((link) => (
            <a
              key={link.href}
              className="nav-link"
              href={link.href}
              aria-current={isCurrent(pathname, link.href) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <StatusPill />
      </div>
    </header>
  );
}
