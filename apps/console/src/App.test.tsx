import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the idle replay shell", () => {
  render(<App />);
  expect(screen.getAllByText(/PHANTASM/).length).toBeGreaterThan(0);
  expect(screen.getByText(/AGENT\s+IDLE/)).toBeTruthy();
  expect(screen.getByText("REPLAY")).toBeTruthy();
  expect(screen.getByText(/awaiting mission deployment/)).toBeTruthy();
  expect(screen.queryByText(/MOCK INTELLIGENCE FEED/)).toBeNull();
  expect(screen.queryByText("AGENT_04")).toBeNull();
  expect(screen.queryByText(/v0\.9\.6/)).toBeNull();
  expect(screen.queryByText(/nexora-deals/)).toBeNull();
  expect(screen.queryByText("Fake E-commerce")).toBeNull();
  expect(screen.getByText(/PHANTASM CORE v\d/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Simulate error/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Presentation Mode/ }));
  expect(document.querySelector("main.presentation")).toBeTruthy();
});
