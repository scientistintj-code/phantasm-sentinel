import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Terminal, type TerminalLine } from "./components/Terminal";

const line = (id: string, message: string): TerminalLine => ({
  id,
  time: "00:00:01",
  tag: "TRACE",
  tone: "info",
  module: "agent",
  message,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("announces terminal lines on a polite log, throttled to one update", () => {
  vi.useFakeTimers();
  const view = render(<Terminal lines={[]} resetKey="case" />);
  const log = screen.getByRole("log");
  expect(log.getAttribute("aria-live")).toBe("polite");
  expect(log.textContent).toBe("");

  view.rerender(<Terminal lines={[line("1", "first"), line("2", "second")]} resetKey="case" />);
  expect(log.textContent).toBe("");
  act(() => {
    vi.advanceTimersByTime(999);
  });
  expect(log.textContent).toBe("");
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(log.textContent).toBe("2 new events. TRACE agent: second");
});

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.slice(1);
  const r = channel(parseInt(raw.slice(0, 2), 16));
  const g = channel(parseInt(raw.slice(2, 4), 16));
  const b = channel(parseInt(raw.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

it("keeps muted text at 4.5:1 and respects reduced motion", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const css = `${readFileSync(join(dir, "styles/dashboard.css"), "utf8")}\n${readFileSync(join(dir, "styles/states.css"), "utf8")}`;
  expect(contrast("#74869b", "#070b13")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#74869b", "#0a101c")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#8ea3b8", "#070b13")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#3d4c5a", "#eef4f7")).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#1c4036", "#e8f8f3")).toBeGreaterThanOrEqual(4.5);
  expect(css).toContain("prefers-reduced-motion");
  expect(css).toContain(".skip-link");
  expect(css).toContain("max-width: 360px");
  for (const hex of ["#516275", "#47586a", "#526276", "#66798c", "#68788a"]) {
    expect(css.toLowerCase().includes(hex)).toBe(false);
  }
});
