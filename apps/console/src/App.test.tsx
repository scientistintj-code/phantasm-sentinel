import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
});

function deployButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /DEPLOY AGENT|STOP AGENT|DEPLOYING|MISSION COMPLETE/ }) as HTMLButtonElement;
}

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
  expect(screen.getAllByText("Managed by Tiny Fish").length).toBeGreaterThan(0);
  expect(screen.getByText("max 1 by key pool")).toBeTruthy();
  expect(screen.getByText("key-1")).toBeTruthy();
  expect(screen.getByText("Search")).toBeTruthy();
  expect(screen.getByText("Browser Context Profiles")).toBeTruthy();
  expect(deployButton().disabled).toBe(true);
});

it("adds removable targets, fills focus, and deploys a replay", () => {
  render(<App />);
  const input = screen.getByPlaceholderText("https://suspicious-site.example");
  fireEvent.change(input, { target: { value: "ftp://files.example/a" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Enter an http(s) URL")).toBeTruthy();

  fireEvent.change(input, { target: { value: "https://checkout.example/pay" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("checkout.example/pay")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Suggested focus/ }));
  const focus = screen.getByLabelText(/Investigation focus/) as HTMLTextAreaElement;
  expect(focus.value).toContain("payment endpoints");
  expect(screen.getByText(`${focus.value.length}/300`)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "lab-e.example" }));
  expect(screen.getAllByText("lab-e.example").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText(/max_parallel/), { target: { value: "4" } });
  expect(screen.getByText("max 4 by key pool")).toBeTruthy();
  expect(screen.getByRole("button", { name: "4x" })).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/Investigator name/), { target: { value: "Ada" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I am authorized to investigate these targets/ }));
  expect(deployButton().disabled).toBe(false);
  fireEvent.click(deployButton());
  expect(screen.getByRole("button", { name: /STOP AGENT/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Presentation Mode/ }));
  expect(document.querySelector("main.presentation")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /STOP AGENT/ }));
  expect(screen.getByRole("button", { name: /DEPLOY AGENT/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove https://checkout.example/pay" }));
  expect(screen.queryByText("checkout.example/pay")).toBeNull();
});
