import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentView } from "./components/LiveAgentView";
import { StreamFrame } from "./components/StreamFrame";
import { allowedStreamUrl } from "./streamFrame";

const ORIGINS = ["https://stream.example"];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("rejects javascript, data, and origins outside the allow-list", () => {
  expect(allowedStreamUrl("javascript:alert(1)", ORIGINS)).toBeNull();
  expect(allowedStreamUrl("data:text/html,hi", ORIGINS)).toBeNull();
  expect(allowedStreamUrl("https://evil.example/watch", ORIGINS)).toBeNull();
  expect(allowedStreamUrl("https://user:pass@stream.example/watch", ORIGINS)).toBeNull();
  expect(allowedStreamUrl("https://stream.example/watch", ORIGINS)).toBe("https://stream.example/watch");
});

it("embeds an allowed stream and falls back after the load timeout", () => {
  vi.useFakeTimers();
  render(<StreamFrame streamingUrl="https://stream.example/watch" origins={ORIGINS} recorded={false} />);
  const frame = screen.getByTitle("Live agent stream") as HTMLIFrameElement;
  expect(frame.src).toBe("https://stream.example/watch");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  expect(frame.getAttribute("allow")).toBe("fullscreen");
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(document.querySelector(".scanline")).toBeTruthy();

  fireEvent.load(frame);
  expect(document.querySelector(".scanline")).toBeNull();

  cleanup();
  render(<StreamFrame streamingUrl="https://stream.example/watch" origins={ORIGINS} recorded={false} />);
  act(() => {
    vi.advanceTimersByTime(6000);
  });
  expect(screen.getByText("Stream unavailable")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("https://stream.example/watch");
  expect(document.querySelector(".scanline")).toBeNull();
  expect(screen.queryByTitle("Live agent stream")).toBeNull();
});

it("hides the open link when the stream url is not allowed", () => {
  render(<StreamFrame streamingUrl="javascript:alert(1)" origins={ORIGINS} recorded={false} />);
  expect(screen.getByText("Stream unavailable")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open in new tab" })).toBeNull();
  expect(screen.queryByTitle("Live agent stream")).toBeNull();
});

it("shows a recorded run and the target host with a replay badge", () => {
  render(
    <LiveAgentView
      targets={[]}
      selectedTargetId="all"
      address="shop.example"
      mode="replay"
      streamingUrl="https://stream.example/watch"
      streamOrigins={ORIGINS}
      phaseIndex={-1}
      complete={false}
      lines={[]}
      pivots={[]}
      onSelectTarget={() => undefined}
      onApprovePivot={() => undefined}
      onDismissPivot={() => undefined}
    />,
  );
  expect(screen.getByText("shop.example")).toBeTruthy();
  expect(screen.getByText("REPLAY")).toBeTruthy();
  expect(screen.getByText("Recorded run")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open in new tab" })).toBeTruthy();
  expect(document.querySelector(".scanline")).toBeNull();
  expect(screen.queryByTitle("Live agent stream")).toBeNull();
});
