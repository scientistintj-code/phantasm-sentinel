import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { RouteLoading } from "./components/RouteLoading";

const root = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
});

test("route loading reserves panel space with a skeleton", () => {
  render(createElement(RouteLoading));
  expect(screen.getByRole("status").textContent).toBe("Loading.");
  expect(document.querySelector(".skeleton")).toBeTruthy();
  expect(document.querySelector(".panel")?.getAttribute("aria-busy")).toBe("true");
});

test("routes declare titles, open graph, favicon, skip link, and print breaks", () => {
  const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
  const css = readFileSync(join(root, "styles/ui.css"), "utf8");
  const icon = readFileSync(join(root, "app/icon.svg"), "utf8");
  expect(layout).toContain('href="#main"');
  expect(layout).toContain("openGraph");
  expect(icon).toContain("<svg");
  for (const file of [
    "app/page.tsx",
    "app/cases/page.tsx",
    "app/cases/[id]/page.tsx",
    "app/cases/[id]/dossier/page.tsx",
    "app/cases/[id]/ledger/page.tsx",
    "app/methodology/page.tsx",
    "app/system/page.tsx",
  ]) {
    const source = readFileSync(join(root, file), "utf8");
    expect(source).toContain("title:");
    expect(source).toContain("openGraph");
  }
  expect(css).toContain("prefers-reduced-motion");
  expect(css).toContain("break-before: page");
  expect(css).toContain("overflow-wrap: anywhere");
  expect(css).toContain(".skeleton");
  expect(css).toContain("max-width: 360px");
});
