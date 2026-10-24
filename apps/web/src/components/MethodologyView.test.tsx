import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { MethodologyView } from "./MethodologyView";

afterEach(() => {
  cleanup();
});

const WEIGHTS = "safe 0, medium 8, high 16.";

test("shows loading, empty, and error states", () => {
  const { rerender } = render(<MethodologyView text={null} error={null} loading />);
  expect(screen.getByRole("status").textContent).toBe("Loading methodology.");

  rerender(<MethodologyView text={null} error={null} />);
  expect(screen.getByText("No methodology text.")).toBeTruthy();

  rerender(<MethodologyView text={null} error="Methodology could not be loaded." />);
  expect(screen.getByRole("alert").textContent).toBe("Methodology could not be loaded.");
  expect(screen.queryByText("Pipeline")).toBeNull();
});

test("renders the pipeline, the stop rule, the weights, and the ledger limit", () => {
  render(<MethodologyView text={WEIGHTS} error={null} />);
  expect(screen.getByRole("heading", { name: "Pipeline" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Passive and active steps" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Stop before payment and synthetic identity" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Heuristic risk weights" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ledger" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Limitations" })).toBeTruthy();
  expect(screen.getByText(WEIGHTS).className).toBe("dossier-weights");
  expect(screen.getByText(/not court-ready/)).toBeTruthy();
  expect(screen.getByText(/Stop before any payment/)).toBeTruthy();
});
