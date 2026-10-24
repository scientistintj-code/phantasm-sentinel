import { expect, test } from "vitest";

import {
  STOREFRONT_IDS,
  getCurrentStorefront,
  paymentWidgetPayload,
  resolveStorefrontId,
  storefronts,
  type StorefrontId,
} from "./storefronts";

const bannedWords = [
  "viagra",
  "xanax",
  "oxycodone",
  "fentanyl",
  "adderall",
  "cialis",
  "percocet",
  "tramadol",
  "hydrocodone",
];

function indicators(id: StorefrontId): readonly string[] {
  const store = storefronts[id];
  return [
    store.payment.publishableKey,
    store.payment.processorHost,
    store.payment.statementDescriptor,
    store.contact.telegram,
    store.contact.email,
  ];
}

test("a, b, and c share one payment cluster", () => {
  const cluster = {
    publishableKey: "LAB_PK_LIVE_ALPHA",
    processorHost: "pay.labgate-one.example",
    statementDescriptor: "RXGLOBAL SERVICES",
  };
  expect(storefronts.a.payment).toEqual(cluster);
  expect(storefronts.b.payment).toBe(storefronts.a.payment);
  expect(storefronts.c.payment).toBe(storefronts.a.payment);
  expect(paymentWidgetPayload(storefronts.b.payment)).toBe(
    paymentWidgetPayload(storefronts.a.payment),
  );
  expect(paymentWidgetPayload(storefronts.c.payment)).toBe(
    paymentWidgetPayload(storefronts.a.payment),
  );
});

test("d uses the beta key and c's Telegram handle", () => {
  expect(storefronts.d.payment).toEqual({
    publishableKey: "LAB_PK_LIVE_BETA",
    processorHost: "pay.yellowfold-gate.example",
    statementDescriptor: "YELLOWFOLD PAPER",
  });
  expect(storefronts.d.payment).not.toBe(storefronts.a.payment);
  expect(storefronts.d.payment.publishableKey).not.toBe(
    storefronts.a.payment.publishableKey,
  );
  expect(storefronts.d.payment.processorHost).not.toBe(
    storefronts.a.payment.processorHost,
  );
  expect(storefronts.d.payment.statementDescriptor).not.toBe(
    storefronts.a.payment.statementDescriptor,
  );
  expect(storefronts.d.contact.telegram).toBe(storefronts.c.contact.telegram);
  expect(storefronts.d.contact.telegram).toBe("@kilnwindow");
  expect(storefronts.d.contact.email).not.toBe(storefronts.c.contact.email);
});

test("e shares no indicator with the other storefronts", () => {
  const decoy = indicators("e");
  expect(decoy).toEqual([
    "LAB_PK_LIVE_GAMMA",
    "pay.saltwire.example",
    "BRINE CLOCK RADIO",
    "@brineclock_ops",
    "listen@brineclock.example",
  ]);
  for (const id of ["a", "b", "c", "d"] as const) {
    const other = indicators(id);
    expect(decoy).toHaveLength(other.length);
    for (let index = 0; index < decoy.length; index += 1) {
      expect(decoy[index]).not.toBe(other[index]);
    }
  }
});

test("contact handles and payment hosts stay fictional and distinct", () => {
  const emails = STOREFRONT_IDS.map((id) => storefronts[id].contact.email);
  const telegrams = STOREFRONT_IDS.map(
    (id) => storefronts[id].contact.telegram,
  );
  expect(new Set(emails).size).toBe(5);
  expect(new Set(telegrams).size).toBe(4);
  for (const id of STOREFRONT_IDS) {
    const store = storefronts[id];
    expect(store.id).toBe(id);
    expect(store.contact.email).toMatch(/^[a-z0-9.]+@[a-z0-9.-]+\.example$/);
    expect(store.contact.telegram).toMatch(/^@[a-z0-9_]{3,32}$/);
    expect(store.payment.publishableKey).toMatch(/^LAB_PK_LIVE_[A-Z]+$/);
    expect(store.payment.processorHost).toMatch(/^[a-z0-9.-]+\.example$/);
    expect(store.payment.processorHost.startsWith("http")).toBe(false);
    expect(store.overlay.newsletterDelayMs).toBe(5000);
  }
});

test("each storefront has its own look, copy, and six products", () => {
  const layouts = new Set(STOREFRONT_IDS.map((id) => storefronts[id].layout));
  const overlays = new Set(
    STOREFRONT_IDS.map((id) => JSON.stringify(storefronts[id].overlay)),
  );
  const names = new Set(STOREFRONT_IDS.map((id) => storefronts[id].name));
  const pitches = new Set(
    STOREFRONT_IDS.map((id) => storefronts[id].overlay.pitch),
  );
  expect(layouts.size).toBe(STOREFRONT_IDS.length);
  expect(overlays.size).toBe(STOREFRONT_IDS.length);
  expect(names.size).toBe(STOREFRONT_IDS.length);
  expect(pitches.size).toBe(STOREFRONT_IDS.length);

  const productIds: string[] = [];
  for (const id of STOREFRONT_IDS) {
    const store = storefronts[id];
    expect(store.products).toHaveLength(6);
    expect(store.questions.length).toBeGreaterThan(0);
    const productNames = store.products.map((product) => product.name);
    expect(new Set(productNames).size).toBe(6);
    for (const product of store.products) {
      expect(product.priceCents).toBeGreaterThan(0);
      expect(product.blurb.length).toBeGreaterThan(0);
      expect(product.id.startsWith(`${id}-`)).toBe(true);
      productIds.push(product.id);
    }
  }
  expect(new Set(productIds).size).toBe(productIds.length);
});

test("catalog copy uses made-up goods", () => {
  const blob = JSON.stringify(storefronts).toLowerCase();
  for (const word of bannedWords) {
    expect(blob.includes(word)).toBe(false);
  }
});

test("the payment widget JSON exposes only the three lab fields", () => {
  const raw = paymentWidgetPayload(storefronts.a.payment);
  expect(JSON.parse(raw)).toEqual({
    publishableKey: "LAB_PK_LIVE_ALPHA",
    processorHost: "pay.labgate-one.example",
    statementDescriptor: "RXGLOBAL SERVICES",
  });
  const beta = paymentWidgetPayload(storefronts.d.payment);
  expect(beta).toContain("LAB_PK_LIVE_BETA");
  expect(beta).not.toContain("ALPHA");
  expect(beta).not.toContain("kilnwindow");
  const parsed: unknown = JSON.parse(beta);
  expect(parsed).not.toBeNull();
  expect(typeof parsed).toBe("object");
  if (typeof parsed === "object" && parsed !== null) {
    expect(Object.keys(parsed).sort()).toEqual([
      "processorHost",
      "publishableKey",
      "statementDescriptor",
    ]);
  }
});

test("STOREFRONT_ID defaults to a and rejects unknown ids", () => {
  expect(resolveStorefrontId(undefined)).toBe("a");
  expect(resolveStorefrontId("")).toBe("a");
  expect(resolveStorefrontId("  e  ")).toBe("e");
  expect(() => resolveStorefrontId("f")).toThrow(/STOREFRONT_ID/);
  expect(() => resolveStorefrontId("A")).toThrow(/a, b, c, d, e/);
});

test("getCurrentStorefront reads STOREFRONT_ID", () => {
  const previous = process.env.STOREFRONT_ID;
  process.env.STOREFRONT_ID = "e";
  try {
    expect(getCurrentStorefront().id).toBe("e");
  } finally {
    if (previous === undefined) {
      delete process.env.STOREFRONT_ID;
    } else {
      process.env.STOREFRONT_ID = previous;
    }
  }
});
