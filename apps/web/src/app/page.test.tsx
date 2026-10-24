import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import Home from "./page";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  redirect,
}));

afterEach(() => {
  cleanup();
  redirect.mockClear();
});

test("home redirects to /cases", () => {
  render(<Home />);
  expect(redirect).toHaveBeenCalledTimes(1);
  expect(redirect).toHaveBeenCalledWith("/cases");
});
