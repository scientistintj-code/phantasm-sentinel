import { expect, test } from "vitest";

import { POST } from "./route";

test("checkout ignores the body and redirects to the decline page", async () => {
  const marker = "do-not-store-marker";
  const request = new Request(
    `http://lab.localhost/api/checkout?card=${marker}`,
    {
      method: "POST",
      body: marker,
    },
  );

  const response = POST(request);

  expect(request.bodyUsed).toBe(false);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/declined");
  expect(await response.text()).not.toContain(marker);
});
