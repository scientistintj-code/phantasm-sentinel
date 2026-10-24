import Link from "next/link";
import type { ReactNode } from "react";

import { CartLink } from "@/components/cart-link";
import type { Storefront } from "@/lib/storefronts";

export function SiteFrame({
  name,
  kicker,
  tagline,
  contact,
  children,
}: {
  name: string;
  kicker: string;
  tagline: string;
  contact: Storefront["contact"];
  children: ReactNode;
}) {
  return (
    <div id="site-frame">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          <p className="kicker">{kicker}</p>
          <p className="name">
            <Link href="/">{name}</Link>
          </p>
          <p className="tagline">{tagline}</p>
        </div>
        <CartLink />
      </header>
      <main id="content" className="content">
        {children}
      </main>
      <section className="contact" aria-labelledby="contact-heading">
        <h2 id="contact-heading">Contact</h2>
        <p>
          Telegram{" "}
          <span className="handle" translate="no">
            {contact.telegram}
          </span>
        </p>
        <p>
          Email{" "}
          <a href={`mailto:${contact.email}`} translate="no">
            {contact.email}
          </a>
        </p>
      </section>
      <footer className="site-footer">
        <p className="lab-mark">Synthetic lab target</p>
      </footer>
    </div>
  );
}
