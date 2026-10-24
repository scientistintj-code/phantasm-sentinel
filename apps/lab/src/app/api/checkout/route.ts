// The body is never read. This lab does not process, store, or log a payment.
// Location stays relative so the browser keeps the host it posted to.

export function POST(): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: "/declined" },
  });
}
