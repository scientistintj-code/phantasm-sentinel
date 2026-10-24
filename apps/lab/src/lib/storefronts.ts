/**
 * Synthetic storefronts for the lab. One deploy renders one id.
 * a, b, and c share one payment cluster.
 * d uses a different publishable key and shares c's Telegram handle.
 * e shares no payment or contact indicator with the others.
 * Client components must take props from a server page so this module
 * stays out of the browser bundle.
 */

export const STOREFRONT_IDS = ["a", "b", "c", "d", "e"] as const;

export type StorefrontId = (typeof STOREFRONT_IDS)[number];

export type StorefrontLayout =
  "column" | "spec" | "magazine" | "sticker" | "terminal";

export type OverlayConfig = {
  age: "center" | "fullscreen" | "sheet" | "checkbox" | "twice";
  cookie: "bottom" | "top" | "modal" | "tall" | "corner";
  newsletter: "inert" | "delay" | "reopen" | "opposite" | "countdown";
  newsletterDelayMs: number;
  pitch: string;
};

export type PaymentConfig = {
  publishableKey: string;
  processorHost: string;
  statementDescriptor: string;
};

export type Product = {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
};

export type Question = {
  id: string;
  prompt: string;
  options: readonly string[];
};

export type Storefront = {
  id: StorefrontId;
  name: string;
  kicker: string;
  tagline: string;
  catalogTitle: string;
  layout: StorefrontLayout;
  overlay: OverlayConfig;
  contact: { telegram: string; email: string };
  payment: PaymentConfig;
  products: readonly Product[];
  questions: readonly Question[];
};

const clusterPayment: PaymentConfig = Object.freeze({
  publishableKey: "LAB_PK_LIVE_ALPHA",
  processorHost: "pay.labgate-one.example",
  statementDescriptor: "RXGLOBAL SERVICES",
});

const kilnWindow = "@kilnwindow";

const newsletterDelayMs = 5000;

export const storefronts: Record<StorefrontId, Storefront> = {
  a: {
    id: "a",
    name: "Marrow & Wick",
    kicker: "Hearth goods",
    tagline: "Candles and tins from a town that is not real.",
    catalogTitle: "On the shelf",
    layout: "column",
    overlay: {
      age: "center",
      cookie: "bottom",
      newsletter: "inert",
      newsletterDelayMs,
      pitch: "Occasional hearth notes. They stay in this browser.",
    },
    contact: {
      telegram: "@marrowwick_desk",
      email: "desk@marrowwick.example",
    },
    payment: clusterPayment,
    products: [
      {
        id: "a-wickmoth",
        name: "Wickmoth Pillar",
        priceCents: 4200,
        blurb: "A tall candle named for a moth that does not exist.",
      },
      {
        id: "a-brineglass",
        name: "Brineglass Ember",
        priceCents: 2800,
        blurb: "Smoke-colored glass around a fictional salt scent.",
      },
      {
        id: "a-lowtide",
        name: "Lowtide Cedar Cone",
        priceCents: 1800,
        blurb: "A wax cone with an invented cedar-and-iron smell.",
      },
      {
        id: "a-sootlantern",
        name: "Sootlantern Tin",
        priceCents: 1600,
        blurb: "A travel tin for a lamp with a made-up wick.",
      },
      {
        id: "a-velthollow",
        name: "Velthollow Coil",
        priceCents: 2200,
        blurb: "Beeswax coil from a hollow that is not on any map.",
      },
      {
        id: "a-ashribbon",
        name: "Ashribbon Disk",
        priceCents: 3600,
        blurb: "A flat hearth disk stamped with a nonsense rune.",
      },
    ],
    questions: [
      {
        id: "a-room",
        prompt: "Which room is this for?",
        options: ["Hearth", "Hall", "Bunk"],
      },
      {
        id: "a-burn",
        prompt: "How long should it burn?",
        options: ["A short hour", "An evening", "Overnight"],
      },
      {
        id: "a-wrap",
        prompt: "Add a paper wrap?",
        options: ["Yes", "No"],
      },
    ],
  },
  b: {
    id: "b",
    name: "Northglass Field Co.",
    kicker: "Field issue 19",
    tagline: "Kit for walks that never happened.",
    catalogTitle: "Issue kit",
    layout: "spec",
    overlay: {
      age: "fullscreen",
      cookie: "top",
      newsletter: "delay",
      newsletterDelayMs,
      pitch: "Trail bulletins that never leave this page.",
    },
    contact: {
      telegram: "@northglass_field",
      email: "field@northglass.example",
    },
    payment: clusterPayment,
    products: [
      {
        id: "b-kelpstride",
        name: "Kelpstride Gaiters",
        priceCents: 5400,
        blurb: "Leg wraps cut for a shoreline that is fictional.",
      },
      {
        id: "b-fennelloop",
        name: "Fennelloop Compass",
        priceCents: 4800,
        blurb: "A compass rose labeled with invented headings.",
      },
      {
        id: "b-ridgequiet",
        name: "Ridgequiet Sack",
        priceCents: 12000,
        blurb: "A sleep sack for a ridge that is not on a map.",
      },
      {
        id: "b-moorlantern",
        name: "Moorlantern",
        priceCents: 6400,
        blurb: "A headlamp that shines a made-up moor color.",
      },
      {
        id: "b-saltbark",
        name: "Saltbark Canteen",
        priceCents: 3200,
        blurb: "A canteen wrapped in bark from an imaginary tree.",
      },
      {
        id: "b-driftmap",
        name: "Driftmap Sleeve",
        priceCents: 2700,
        blurb: "A map sleeve printed with a coast that does not exist.",
      },
    ],
    questions: [
      {
        id: "b-trip",
        prompt: "How long is the trip?",
        options: ["One day", "A week", "A season"],
      },
      {
        id: "b-ground",
        prompt: "What is the ground like?",
        options: ["Dry", "Wet", "Frozen"],
      },
      {
        id: "b-trailhead",
        prompt: "Leave it at a trailhead?",
        options: ["Yes", "No"],
      },
    ],
  },
  c: {
    id: "c",
    name: "Kite & Kiln",
    kicker: "Studio notes",
    tagline: "Pots from a kiln with no address.",
    catalogTitle: "Current firing",
    layout: "magazine",
    overlay: {
      age: "sheet",
      cookie: "modal",
      newsletter: "reopen",
      newsletterDelayMs,
      pitch: "Firing dates, fictional, and local to this browser.",
    },
    contact: {
      telegram: kilnWindow,
      email: "studio@kitekiln.example",
    },
    payment: clusterPayment,
    products: [
      {
        id: "c-orrery",
        name: "Orrery Bowl",
        priceCents: 6800,
        blurb: "A pour bowl etched with planets from a toy solar system.",
      },
      {
        id: "c-cinderlip",
        name: "Cinderlip Mug",
        priceCents: 2400,
        blurb: "A mug with a rim glazed the color of invented cinders.",
      },
      {
        id: "c-twotide",
        name: "Two-Tide Platter",
        priceCents: 8000,
        blurb: "An oval platter named for two tides that never meet.",
      },
      {
        id: "c-kilnwindow",
        name: "Kilnwindow Vase",
        priceCents: 9000,
        blurb: "A tall vase meant to sit in a window that is not real.",
      },
      {
        id: "c-silt",
        name: "Silt Pitcher",
        priceCents: 4600,
        blurb: "A pitcher glazed like silt from a fictional river.",
      },
      {
        id: "c-redclay",
        name: "Redclay Spoon Rest",
        priceCents: 1400,
        blurb: "A small rest pressed from clay with a made-up name.",
      },
    ],
    questions: [
      {
        id: "c-place",
        prompt: "Where will it live?",
        options: ["Table", "Wall", "Daily sink"],
      },
      {
        id: "c-clay",
        prompt: "Which clay?",
        options: ["Pale", "Soot", "Red"],
      },
      {
        id: "c-note",
        prompt: "Include a kiln note?",
        options: ["Yes", "No"],
      },
    ],
  },
  d: {
    id: "d",
    name: "Yellowfold Paper",
    kicker: "Desk club",
    tagline: "Paper goods with invented weights.",
    catalogTitle: "Desk goods",
    layout: "sticker",
    overlay: {
      age: "checkbox",
      cookie: "tall",
      newsletter: "opposite",
      newsletterDelayMs,
      pitch: "A letter that never leaves the browser.",
    },
    contact: {
      telegram: kilnWindow,
      email: "orders@yellowfold.example",
    },
    payment: {
      publishableKey: "LAB_PK_LIVE_BETA",
      processorHost: "pay.yellowfold-gate.example",
      statementDescriptor: "YELLOWFOLD PAPER",
    },
    products: [
      {
        id: "d-foldedsun",
        name: "Folded-Sun Notebook",
        priceCents: 1800,
        blurb: "A notebook whose paper weight is a made-up number.",
      },
      {
        id: "d-marginmoth",
        name: "Margin Moth Stamps",
        priceCents: 900,
        blurb: "Stamps of a moth drawn for this shop alone.",
      },
      {
        id: "d-lanternthread",
        name: "Lantern Thread Tape",
        priceCents: 600,
        blurb: "Washi tape printed with a lantern that does not exist.",
      },
      {
        id: "d-nightpost",
        name: "Nightpost Envelopes",
        priceCents: 1200,
        blurb: "Envelopes addressed to a post office in fiction.",
      },
      {
        id: "d-inkweather",
        name: "Inkweather Ruler",
        priceCents: 1100,
        blurb: "A ruler marked in units used only on this page.",
      },
      {
        id: "d-quietclips",
        name: "Quiet Binding Clips",
        priceCents: 800,
        blurb: "Clips painted a yellow that belongs to no brand.",
      },
    ],
    questions: [
      {
        id: "d-paper",
        prompt: "Which paper?",
        options: ["Light", "Mid", "Heavy"],
      },
      {
        id: "d-binding",
        prompt: "Which binding?",
        options: ["Sewn", "Glued", "Loose"],
      },
      {
        id: "d-monogram",
        prompt: "Add a monogram?",
        options: ["Yes", "No"],
      },
    ],
  },
  e: {
    id: "e",
    name: "Brine Clock Radio",
    kicker: "Channel list",
    tagline: "Radios that only receive static.",
    catalogTitle: "In stock",
    layout: "terminal",
    overlay: {
      age: "twice",
      cookie: "corner",
      newsletter: "countdown",
      newsletterDelayMs,
      pitch: "Station mail. The close control waits out a short timer.",
    },
    contact: {
      telegram: "@brineclock_ops",
      email: "listen@brineclock.example",
    },
    payment: {
      publishableKey: "LAB_PK_LIVE_GAMMA",
      processorHost: "pay.saltwire.example",
      statementDescriptor: "BRINE CLOCK RADIO",
    },
    products: [
      {
        id: "e-gullband",
        name: "Gullband Receiver",
        priceCents: 7200,
        blurb: "A pocket receiver tuned to a fictional harbor band.",
      },
      {
        id: "e-orchard",
        name: "Static Orchard Speaker",
        priceCents: 5800,
        blurb: "A speaker that plays an orchard which is not real.",
      },
      {
        id: "e-tidenumeral",
        name: "Tidenumeral Clock",
        priceCents: 4000,
        blurb: "A desk clock with numerals from an invented tide table.",
      },
      {
        id: "e-harbormesh",
        name: "Harbor Mesh Antenna",
        priceCents: 3500,
        blurb: "A mesh aerial for a port that exists only here.",
      },
      {
        id: "e-lowvolt",
        name: "Lowvolt Hummer",
        priceCents: 2200,
        blurb: "A small hum box with a voltage that is not a standard.",
      },
      {
        id: "e-channelnine",
        name: "Channel Nine Earpiece",
        priceCents: 1900,
        blurb: "An earpiece labeled for a channel with no broadcast.",
      },
    ],
    questions: [
      {
        id: "e-power",
        prompt: "Which power?",
        options: ["Battery", "Crank", "Mains"],
      },
      {
        id: "e-band",
        prompt: "Which band?",
        options: ["Harbor", "Inland", "Both"],
      },
      {
        id: "e-call",
        prompt: "Scratch a call sign?",
        options: ["Yes", "No"],
      },
    ],
  },
};

export function isStorefrontId(value: string): value is StorefrontId {
  return (STOREFRONT_IDS as readonly string[]).includes(value);
}

export function resolveStorefrontId(value: string | undefined): StorefrontId {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return "a";
  }
  if (isStorefrontId(trimmed)) {
    return trimmed;
  }
  const preview = trimmed.slice(0, 24);
  throw new Error(
    `STOREFRONT_ID must be one of ${STOREFRONT_IDS.join(", ")}. Received "${preview}".`,
  );
}

export function getCurrentStorefront(): Storefront {
  return storefronts[resolveStorefrontId(process.env.STOREFRONT_ID)];
}

export function paymentWidgetPayload(payment: PaymentConfig): string {
  return JSON.stringify({
    publishableKey: payment.publishableKey,
    processorHost: payment.processorHost,
    statementDescriptor: payment.statementDescriptor,
  }).replaceAll("<", "\\u003c");
}
