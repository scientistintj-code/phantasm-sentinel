import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import Home from "./page";

afterEach(() => {
  cleanup();
});

test("home page is blank", () => {
  const { container } = render(<Home />);
  expect(container.querySelector("main")).not.toBeNull();
  expect(container.textContent).toBe("");
});
