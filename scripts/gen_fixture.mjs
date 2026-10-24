/**
 * Deterministic lab fixtures. No randomness.
 * Run: node scripts/gen_fixture.mjs
 *
 * Ledger signing secret for this fixture only: lab-fixture-ledger-secret
 */
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CASE_ID = "c0ffee00-0000-4000-8000-000000000001";
const SIGNING_SECRET = "lab-fixture-ledger-secret";
const T0 = Date.parse("2026-10-24T12:00:00.000Z");
const SCHEMA_VERSION = "2.4";
const CASE_DONE_MS = 45000;

const ALPHA = "LAB_PK_LIVE_ALPHA";
const BETA = "LAB_PK_LIVE_BETA";
const ECHO_KEY = "LAB_PK_TEST_ECHO";
const GATE = "pay.labgate-one.example";
const SCRIPT_HOST = "cdn.labgate-one.example";
const DESCRIPTOR = "RXGLOBAL SERVICES";
const TELEGRAM = "t.me/rxglobal_desk";

const EVIDENCE_FIELDS = [
  ["merchant_id", "Merchant ID"],
  ["gateway", "Gateway"],
  ["payment_endpoint", "Payment Endpoint"],
  ["host_ip", "Host IP"],
  ["domain_age", "Domain Age"],
  ["ssl_issuer", "SSL Issuer"],
  ["suspicious_scripts", "Suspicious Scripts"],
  ["redirect_chain", "Redirect Chain"],
];

const PHASES = [
  "init_browser",
  "load_site",
  "bypass_popups",
  "navigate_checkout",
  "collect_evidence",
  "validate_payload",
  "build_graph",
];

const STEP_BANK = [
  "Dismiss popup",
  "Accept cookie banner",
  "Add item to cart",
  "Open checkout",
  "Fill shipping form",
  "Reach payment stage",
  "Read publishable key from the checkout script",
  "Capture the statement descriptor",
  "Record the redirect chain",
];

const NODE_KIND = {
  publishable_key: "merchant",
  merchant_id: "merchant",
  client_id: "merchant",
  processor_host: "gateway",
  form_action_host: "gateway",
  checkout_script_host: "gateway",
  ip: "host",
  descriptor: "bank",
  telegram: "contact",
  email: "contact",
  phone: "contact",
};

const targets = [
  {
    id: "tgt_lab_a",
    slug: "a",
    url: "https://lab-a.example",
    host: "lab-a.example",
    key: "key-1",
    run: "run_lab_a",
    offset: 1000,
    steps: 7,
    score: 86,
    label: "HIGH",
    verdict: "Shared merchant infrastructure and malicious checkout behavior detected",
    searchSummary: "2 sibling hosts share this checkout copy",
    indicators: [
      ind("publishable_key", ALPHA, 0.99, "agent"),
      ind("merchant_id", "MID_LAB_A_4401", 0.96, "agent"),
      ind("processor_host", GATE, 0.98, "agent"),
      ind("checkout_script_host", SCRIPT_HOST, 0.91, "agent"),
      ind("descriptor", DESCRIPTOR, 0.94, "agent"),
      ind("ip", "203.0.113.11", 0.9, "infra"),
      ind("email", "billing-a@rxglobal-mail.example", 0.8, "agent"),
      ind("ns", "ns1.labdns.example", 0.7, "infra"),
      ind("cert_fingerprint", "a1:11:11:11:11:11:11:11", 0.88, "infra"),
      ind("registrar", "LabReg Ltd", 0.75, "infra"),
      ind("domain", "lab-a.example", 1, "infra"),
    ],
    evidence: [
      ev("merchant_id", "MID_LAB_A_4401", "high", "agent"),
      ev("gateway", "LabGate One", "high", "agent"),
      ev("payment_endpoint", "https://pay.labgate-one.example/v1/charge", "high", "agent"),
      ev("host_ip", "203.0.113.11", "medium", "infra"),
      ev("domain_age", "9 days", "high", "derived"),
      ev("ssl_issuer", "R3 / Let's Encrypt", "safe", "infra"),
      ev("suspicious_scripts", "3 detected", "high", "agent"),
      ev("redirect_chain", "4 hops", "medium", "derived"),
    ],
    failedChecks: {
      domain_age: "Domain age 9 days is under 30 days",
      suspicious_scripts: "3 checkout scripts load from an unrelated host",
    },
  },
  {
    id: "tgt_lab_b",
    slug: "b",
    url: "https://lab-b.example",
    host: "lab-b.example",
    key: "key-2",
    run: "run_lab_b",
    offset: 5000,
    steps: 6,
    score: 80,
    label: "HIGH",
    verdict: "Shared merchant infrastructure and malicious checkout behavior detected",
    searchSummary: "Same publishable key as lab-a.example",
    indicators: [
      ind("publishable_key", ALPHA, 0.99, "agent"),
      ind("merchant_id", "MID_LAB_B_4402", 0.95, "agent"),
      ind("processor_host", GATE, 0.97, "agent"),
      ind("checkout_script_host", SCRIPT_HOST, 0.9, "agent"),
      ind("descriptor", DESCRIPTOR, 0.93, "agent"),
      ind("ip", "203.0.113.12", 0.9, "infra"),
      ind("email", "billing-b@rxglobal-mail.example", 0.8, "agent"),
      ind("ns", "ns1.labdns.example", 0.7, "infra"),
      ind("cert_fingerprint", "b2:22:22:22:22:22:22:22", 0.88, "infra"),
      ind("registrar", "LabReg Ltd", 0.75, "infra"),
      ind("domain", "lab-b.example", 1, "infra"),
    ],
    evidence: [
      ev("merchant_id", "MID_LAB_B_4402", "high", "agent"),
      ev("gateway", "LabGate One", "high", "agent"),
      ev("payment_endpoint", "https://pay.labgate-one.example/v1/charge", "high", "agent"),
      ev("host_ip", "203.0.113.12", "medium", "infra"),
      ev("domain_age", "12 days", "high", "derived"),
      ev("ssl_issuer", "R3 / Let's Encrypt", "safe", "infra"),
      ev("suspicious_scripts", "2 detected", "high", "agent"),
      ev("redirect_chain", "3 hops", "medium", "derived"),
    ],
    failedChecks: {
      suspicious_scripts: "2 checkout scripts load from an unrelated host",
      redirect_chain: "3 hops leave the storefront host before payment",
    },
  },
  {
    id: "tgt_lab_c",
    slug: "c",
    url: "https://lab-c.example",
    host: "lab-c.example",
    key: "key-3",
    run: "run_lab_c",
    offset: 9000,
    steps: 8,
    score: 92,
    label: "HIGH",
    verdict: "Shared merchant infrastructure and malicious checkout behavior detected",
    searchSummary: "Telegram handle posted beside the shared descriptor",
    pivot: true,
    indicators: [
      ind("publishable_key", ALPHA, 0.99, "agent"),
      ind("merchant_id", "MID_LAB_C_4403", 0.97, "agent"),
      ind("processor_host", GATE, 0.98, "agent"),
      ind("checkout_script_host", SCRIPT_HOST, 0.92, "agent"),
      ind("descriptor", DESCRIPTOR, 0.96, "agent"),
      ind("telegram", TELEGRAM, 0.93, "agent"),
      ind("phone", "+15551230003", 0.7, "agent"),
      ind("ip", "203.0.113.13", 0.9, "infra"),
      ind("ns", "ns1.labdns.example", 0.7, "infra"),
      ind("cert_fingerprint", "c3:33:33:33:33:33:33:33", 0.88, "infra"),
      ind("registrar", "LabReg Ltd", 0.75, "infra"),
      ind("domain", "lab-c.example", 1, "infra"),
    ],
    evidence: [
      ev("merchant_id", "MID_LAB_C_4403", "high", "agent"),
      ev("gateway", "LabGate One", "high", "agent"),
      ev("payment_endpoint", "https://pay.labgate-one.example/v1/charge", "high", "agent"),
      ev("host_ip", "203.0.113.13", "high", "infra"),
      ev("domain_age", "6 days", "high", "derived"),
      ev("ssl_issuer", "R3 / Let's Encrypt", "safe", "infra"),
      ev("suspicious_scripts", "4 detected", "high", "agent"),
      ev("redirect_chain", "5 hops", "high", "derived"),
    ],
    failedChecks: {
      domain_age: "Domain age 6 days is under 30 days",
      suspicious_scripts: "4 checkout scripts load from an unrelated host",
      redirect_chain: "5 hops leave the storefront host before payment",
    },
  },
  {
    id: "tgt_lab_d",
    slug: "d",
    url: "https://lab-d.example",
    host: "lab-d.example",
    key: "key-1",
    run: "run_lab_d",
    offset: 21000,
    steps: 5,
    score: 68,
    label: "MEDIUM",
    verdict: "Unverified infrastructure - manual review recommended",
    searchSummary: "Distinct publishable key; Telegram matches lab-c.example",
    indicators: [
      ind("publishable_key", BETA, 0.9, "agent"),
      ind("merchant_id", "MID_LAB_D_5501", 0.84, "agent"),
      ind("processor_host", "pay.labgate-two.example", 0.8, "agent"),
      ind("checkout_script_host", "cdn.labgate-two.example", 0.72, "agent"),
      ind("descriptor", "NORTHWIND MARKETS", 0.7, "agent"),
      ind("telegram", TELEGRAM, 0.93, "agent"),
      ind("email", "desk@northwind-markets.example", 0.66, "agent"),
      ind("ip", "203.0.113.14", 0.85, "infra"),
      ind("ns", "ns1.northwind-dns.example", 0.7, "infra"),
      ind("cert_fingerprint", "d4:44:44:44:44:44:44:44", 0.8, "infra"),
      ind("registrar", "Northwind Registrar", 0.7, "infra"),
      ind("domain", "lab-d.example", 1, "infra"),
    ],
    evidence: [
      ev("merchant_id", "MID_LAB_D_5501", "medium", "agent"),
      ev("gateway", "LabGate Two", "medium", "agent"),
      ev("payment_endpoint", "https://pay.labgate-two.example/v1/charge", "medium", "agent"),
      ev("host_ip", "203.0.113.14", "medium", "infra"),
      ev("domain_age", "40 days", "medium", "derived"),
      ev("ssl_issuer", "Valid certificate", "safe", "infra"),
      ev("suspicious_scripts", "1 flagged", "medium", "agent"),
      ev("redirect_chain", "2 hops", "medium", "derived"),
    ],
    failedChecks: {
      suspicious_scripts: "1 flagged script is not on the storefront host",
      redirect_chain: "2 hops leave the storefront host before payment",
    },
  },
  {
    id: "tgt_lab_e",
    slug: "e",
    url: "https://lab-e.example",
    host: "lab-e.example",
    key: "key-2",
    run: "run_lab_e",
    offset: 30000,
    steps: 9,
    score: 18,
    label: "LOW",
    verdict: "Demo/test environment - no fraud indicators found",
    searchSummary: "0 suspicious mirrors found",
    indicators: [
      ind("publishable_key", ECHO_KEY, 0.6, "agent"),
      ind("merchant_id", "MID_ECHO_9001", 0.55, "agent"),
      ind("client_id", "cid_echo_e", 0.5, "agent"),
      ind("processor_host", "pay.echo-widgets.example", 0.5, "agent"),
      ind("form_action_host", "forms.echo-widgets.example", 0.5, "agent"),
      ind("checkout_script_host", "static.echo-widgets.example", 0.5, "agent"),
      ind("descriptor", "ECHO WIDGETS LLC", 0.5, "agent"),
      ind("telegram", "t.me/echo_widgets_help", 0.4, "agent"),
      ind("email", "hello@lab-e.example", 0.4, "agent"),
      ind("phone", "+15550000005", 0.4, "agent"),
      ind("ip", "198.51.100.50", 0.9, "infra"),
      ind("ns", "ns1.echo-dns.example", 0.7, "infra"),
      ind("cert_fingerprint", "e5:55:55:55:55:55:55:55", 0.8, "infra"),
      ind("registrar", "Echo Registrar", 0.7, "infra"),
      ind("domain", "lab-e.example", 1, "infra"),
    ],
    evidence: [
      ev("merchant_id", "MID_ECHO_9001", "safe", "agent"),
      ev("gateway", "Echo Pay", "safe", "agent"),
      ev("payment_endpoint", "https://pay.echo-widgets.example/checkout", "safe", "agent"),
      ev("host_ip", "198.51.100.50", "safe", "infra"),
      ev("domain_age", "8 years", "safe", "derived"),
      ev("ssl_issuer", "Amazon RSA 2048", "safe", "infra"),
      ev("suspicious_scripts", "0", "safe", "agent"),
      ev("redirect_chain", "clean", "safe", "derived"),
    ],
    failedChecks: {},
  },
];

function ind(kind, value, confidence, source) {
  return { kind, value, confidence, source };
}

function ev(field, value, severity, source) {
  const label = EVIDENCE_FIELDS.find((row) => row[0] === field)[1];
  return { field, label, value, severity, source };
}

function reportFor(target) {
  const checks = EVIDENCE_FIELDS.map(([field]) => {
    const reason = target.failedChecks[field];
    if (reason) return { field, passed: false, reason };
    return { field, passed: true };
  });
  const passed = checks.filter((check) => check.passed).length;
  const report = {
    target_id: target.id,
    host: target.host,
    risk: {
      score: target.score,
      label: target.label,
      evidence_coverage: `${passed}/8`,
      verdict: target.verdict,
    },
    evidence: target.evidence,
  };
  return { report, checks };
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function buildGraph(reports) {
  const nodes = [];
  const edges = [];
  const seen = new Map();
  for (const target of targets) {
    const domainId = `domain:${slug(target.host)}`;
    nodes.push({
      id: domainId,
      type: "domain",
      label: target.host,
      target_id: target.id,
    });
    for (const indicator of target.indicators) {
      const type = NODE_KIND[indicator.kind];
      if (!type) continue;
      const id = `${type}:${slug(indicator.value)}`;
      if (!seen.has(id)) {
        seen.set(id, true);
        nodes.push({ id, type, label: indicator.value });
      }
      edges.push({
        a: domainId,
        b: id,
        weight: indicator.confidence,
        kind: indicator.kind,
      });
    }
  }
  return {
    version: 0,
    nodes,
    edges,
    clusters: [
      {
        id: "clu_high_abcd",
        members: ["tgt_lab_a", "tgt_lab_b", "tgt_lab_c", "tgt_lab_d"],
        confidence: 0.92,
        explanation:
          "HIGH cluster: lab-a, lab-b, and lab-c share publishable key LAB_PK_LIVE_ALPHA, processor host pay.labgate-one.example, and descriptor RXGLOBAL SERVICES. lab-d shares Telegram t.me/rxglobal_desk with lab-c. lab-e is not a member.",
      },
    ],
    insight:
      "One HIGH cluster links lab-a through lab-d. lab-e.example is isolated with indicators that do not recur.",
  };
}

function scheduleTarget(target, built) {
  const { report, checks } = built;
  const steps = STEP_BANK.slice(0, target.steps);
  let rel = 0;
  const rows = [];
  const push = (type, fields, gap) => {
    rel += gap;
    rows.push({
      t_ms: target.offset + rel,
      tie: rows.length + target.offset,
      type,
      target_id: target.id,
      fields,
    });
  };

  push("ModuleStatus", { module: "search", state: "started" }, 0);
  push(
    "ModuleStatus",
    {
      module: "search",
      state: "completed",
      duration_ms: 500,
      summary: target.searchSummary,
    },
    500,
  );
  push(
    "ReconFinding",
    { source: "search", summary: target.searchSummary },
    120,
  );
  push("ModuleStatus", { module: "fetch", state: "started" }, 180);
  push(
    "ModuleStatus",
    {
      module: "fetch",
      state: "completed",
      duration_ms: 700,
      summary: "SPA DOM unpacked to JSON",
    },
    700,
  );
  push(
    "ReconFinding",
    {
      source: "fetch",
      summary: `Fetched ${target.host} and noted the checkout script host`,
    },
    120,
  );
  push("PhaseChanged", { phase: "init_browser" }, 240);
  push("ModuleStatus", { module: "profiles", state: "started" }, 100);
  push("PhaseChanged", { phase: "load_site" }, 400);
  push(
    "ModuleStatus",
    {
      module: "profiles",
      state: "completed",
      duration_ms: 500,
      summary: "Session cookies saved to profile",
    },
    200,
  );
  push("ModuleStatus", { module: "agent", state: "started" }, 200);
  push("ProbeStarted", { run_id: target.run, key_label: target.key }, 120);
  push("StreamingUrl", { url: `https://stream.invalid/${target.run}` }, 120);

  let sawPopup = false;
  let sawCheckout = false;
  steps.forEach((purpose, index) => {
    push("AgentStep", { index: index + 1, purpose }, 480);
    if (!sawPopup && /popup|cookie/i.test(purpose)) {
      sawPopup = true;
      push("PhaseChanged", { phase: "bypass_popups" }, 80);
    }
    if (!sawCheckout && /checkout|payment/i.test(purpose)) {
      sawCheckout = true;
      push("PhaseChanged", { phase: "navigate_checkout" }, 80);
    }
  });

  push(
    "ModuleStatus",
    {
      module: "agent",
      state: "completed",
      duration_ms: target.steps * 480,
      summary: `Checkout reached in ${target.steps} steps`,
    },
    240,
  );
  push("PhaseChanged", { phase: "collect_evidence" }, 180);

  for (const indicator of target.indicators) {
    push("IndicatorExtracted", { indicator }, 140);
    if (target.pivot && indicator.kind === "telegram") {
      push(
        "PivotSuggested",
        {
          pivot_id: "piv_tg_rxglobal",
          indicator,
          query: TELEGRAM,
        },
        100,
      );
    }
  }

  push(
    "ModuleStatus",
    {
      module: "vault",
      state: "skipped",
      summary: "No vault credentials for this lab target",
    },
    160,
  );
  push("PhaseChanged", { phase: "validate_payload" }, 200);
  push(
    "PayloadValidated",
    { schema_version: SCHEMA_VERSION, checks, report },
    360,
  );
  push("PhaseChanged", { phase: "build_graph" }, 220);
  push("GraphUpdated", {}, 180);
  push(
    "ProbeCompleted",
    {
      status: "COMPLETED",
      reached_checkout: true,
      stopped_reason: target.label === "LOW" ? "benign_catalog" : "checkout_captured",
    },
    200,
  );
  return rows;
}

function buildReplay() {
  const built = new Map(targets.map((target) => [target.id, reportFor(target)]));
  const pending = [
    {
      t_ms: 0,
      tie: 0,
      type: "CaseCreated",
      fields: { title: "Lab storefront cluster" },
    },
  ];
  targets.forEach((target, index) => {
    pending.push({
      t_ms: 80 + index * 40,
      tie: index + 1,
      type: "TargetQueued",
      target_id: target.id,
      fields: { url: target.url, host: target.host },
    });
    pending.push(...scheduleTarget(target, built.get(target.id)));
  });
  pending.sort((left, right) => left.t_ms - right.t_ms || left.tie - right.tie);
  const overrun = pending.find((row) => row.t_ms >= CASE_DONE_MS);
  if (overrun) {
    throw new Error(`event at ${overrun.t_ms}ms is not before CaseCompleted`);
  }
  pending.push({
    t_ms: CASE_DONE_MS,
    tie: 0,
    type: "CaseCompleted",
    fields: { targets: 5, failed: 0, clusters: 1 },
  });

  let graphVersion = 0;
  const lines = pending.map((row, index) => {
    const seq = index + 1;
    const ts = new Date(T0 + row.t_ms).toISOString();
    const fields = row.type === "GraphUpdated" ? { version: ++graphVersion } : row.fields;
    const event = { case_id: CASE_ID, seq, ts, type: row.type };
    if (row.target_id) event.target_id = row.target_id;
    Object.assign(event, fields);
    return { t_ms: row.t_ms, event };
  });
  return { lines, graphVersion, reports: targets.map((target) => built.get(target.id).report) };
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ledgerFrom(lines) {
  let prev = sha256(`phantasm-sentinel:genesis:${CASE_ID}`);
  const entries = lines.map(({ event }) => {
    const payload = JSON.parse(JSON.stringify(event));
    const entryHash = sha256(
      `${prev} ${event.seq} ${event.ts} ${canonical(payload)}`,
    );
    const entry = {
      seq: event.seq,
      ts: event.ts,
      event_type: event.type,
      payload,
      prev_hash: prev,
      entry_hash: entryHash,
    };
    prev = entryHash;
    return entry;
  });
  const headHash = entries[entries.length - 1].entry_hash;
  const entryCount = entries.length;
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`${headHash} ${entryCount}`, "utf8")
    .digest("hex");
  return {
    case_id: CASE_ID,
    signing_secret: SIGNING_SECRET,
    entry_count: entryCount,
    head_hash: headHash,
    signature,
    entries,
  };
}

function keysHealth() {
  return [
    { label: "key-1", state: "healthy", in_flight: 0, runs_served: 2 },
    { label: "key-2", state: "healthy", in_flight: 0, runs_served: 2 },
    { label: "key-3", state: "healthy", in_flight: 0, runs_served: 1 },
  ];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verify(lines, reports, graph, ledger, keys) {
  assert(lines[0].t_ms === 0 && lines[0].event.type === "CaseCreated", "start");
  assert(lines.at(-1).t_ms === CASE_DONE_MS, "duration");
  assert(lines.at(-1).event.type === "CaseCompleted", "CaseCompleted last");
  assert(lines.at(-1).event.targets === 5 && lines.at(-1).event.failed === 0, "totals");
  assert(lines.at(-1).event.clusters === 1, "cluster count");
  assert(lines.every((line, index) => line.event.seq === index + 1), "seq");
  for (let i = 1; i < lines.length; i += 1) {
    assert(lines[i].t_ms >= lines[i - 1].t_ms, "time order");
  }

  const byTarget = new Map();
  let pivots = 0;
  for (const { event } of lines) {
    assert(event.case_id === CASE_ID && event.ts.endsWith("Z"), "envelope");
    if (!event.target_id) continue;
    const bucket = byTarget.get(event.target_id) ?? [];
    bucket.push(event);
    byTarget.set(event.target_id, bucket);
    if (event.type === "PivotSuggested") pivots += 1;
  }
  assert(pivots === 1, "one pivot");
  assert(byTarget.size === 5, "five targets");

  for (const target of targets) {
    const events = byTarget.get(target.id);
    const phases = events.filter((event) => event.type === "PhaseChanged").map((event) => event.phase);
    assert(JSON.stringify(phases) === JSON.stringify(PHASES), `${target.slug} phases ${phases}`);
    const steps = events.filter((event) => event.type === "AgentStep");
    assert(steps.length === target.steps && steps.length >= 5 && steps.length <= 9, `${target.slug} steps`);
    steps.forEach((step, index) => assert(step.index === index + 1, "step index"));
    const stream = events.find((event) => event.type === "StreamingUrl");
    assert(stream.url === `https://stream.invalid/${target.run}`, "stream url");
    const validated = events.find((event) => event.type === "PayloadValidated");
    const graphEvent = events.find((event) => event.type === "GraphUpdated");
    assert(validated && graphEvent && graphEvent.seq > validated.seq, `${target.slug} graph after payload`);
    assert(validated.checks.length === 8, "8 checks");
    assert(validated.report.evidence.length === 8, "8 evidence rows");
    assert(
      validated.report.evidence.map((row) => row.field).join() === EVIDENCE_FIELDS.map((row) => row[0]).join(),
      "evidence order",
    );
    const passed = validated.checks.filter((check) => check.passed).length;
    assert(validated.report.risk.evidence_coverage === `${passed}/8`, "coverage");
    assert(validated.schema_version === "2.4", "schema");
    const modules = events.filter((event) => event.type === "ModuleStatus").map((event) => event.module);
    for (const name of ["search", "fetch", "agent", "vault", "profiles"]) {
      assert(modules.includes(name), `${target.slug} module ${name}`);
    }
  }

  const valueSet = (slugName) => {
    const target = targets.find((item) => item.slug === slugName);
    return new Set(target.indicators.map((item) => `${item.kind}:${item.value}`));
  };
  for (const slugName of ["a", "b", "c"]) {
    const values = valueSet(slugName);
    assert(values.has(`publishable_key:${ALPHA}`), slugName);
    assert(values.has(`processor_host:${GATE}`), slugName);
    assert(values.has(`descriptor:${DESCRIPTOR}`), slugName);
  }
  const dValues = valueSet("d");
  const cValues = valueSet("c");
  assert(dValues.has(`publishable_key:${BETA}`), "beta key");
  assert(dValues.has(`telegram:${TELEGRAM}`) && cValues.has(`telegram:${TELEGRAM}`), "shared telegram");
  const used = new Set();
  for (const slugName of ["a", "b", "c", "d"]) {
    for (const indicator of targets.find((item) => item.slug === slugName).indicators) {
      used.add(`${indicator.kind}:${indicator.value}`);
    }
  }
  for (const indicator of targets.find((item) => item.slug === "e").indicators) {
    assert(!used.has(`${indicator.kind}:${indicator.value}`), `e overlaps ${indicator.value}`);
  }

  const scores = Object.fromEntries(reports.map((report) => [report.target_id, report.risk]));
  assert(scores.tgt_lab_a.score === 86 && scores.tgt_lab_a.label === "HIGH", "a risk");
  assert(scores.tgt_lab_b.score === 80 && scores.tgt_lab_b.label === "HIGH", "b risk");
  assert(scores.tgt_lab_c.score === 92 && scores.tgt_lab_c.label === "HIGH", "c risk");
  assert(scores.tgt_lab_d.score === 68 && scores.tgt_lab_d.label === "MEDIUM", "d risk");
  assert(scores.tgt_lab_e.score === 18 && scores.tgt_lab_e.label === "LOW", "e risk");
  assert(scores.tgt_lab_d.score >= 55 && scores.tgt_lab_d.score <= 75, "d band");
  assert(scores.tgt_lab_e.score < 25, "e band");

  assert(graph.version === 5, "graph version");
  assert(graph.clusters.length === 1, "one cluster");
  assert(
    graph.clusters[0].members.join() === "tgt_lab_a,tgt_lab_b,tgt_lab_c,tgt_lab_d",
    "cluster members",
  );
  const memberSet = new Set(graph.clusters[0].members);
  assert(!memberSet.has("tgt_lab_e"), "e isolated");
  const linked = new Set(graph.clusters[0].members);
  const domainNodes = graph.nodes.filter((node) => node.type === "domain");
  assert(domainNodes.length === 5, "domain nodes");
  assert(domainNodes.every((node) => linked.has(node.target_id) || node.target_id === "tgt_lab_e"), "domains");

  assert(ledger.entries.length === lines.length, "ledger length");
  let prev = sha256(`phantasm-sentinel:genesis:${CASE_ID}`);
  ledger.entries.forEach((entry, index) => {
    const event = lines[index].event;
    assert(entry.prev_hash === prev, `prev ${entry.seq}`);
    const again = sha256(`${entry.prev_hash} ${entry.seq} ${entry.ts} ${canonical(entry.payload)}`);
    assert(again === entry.entry_hash, `hash ${entry.seq}`);
    assert(canonical(entry.payload) === canonical(event), `payload ${entry.seq}`);
    prev = entry.entry_hash;
  });
  assert(ledger.head_hash === prev, "head");
  const signature = createHmac("sha256", ledger.signing_secret)
    .update(`${ledger.head_hash} ${ledger.entry_count}`, "utf8")
    .digest("hex");
  assert(signature === ledger.signature, "signature");
  assert(keys.length === 3, "keys");
  assert(keys.map((key) => key.label).join() === "key-1,key-2,key-3", "key labels");
  const served = Object.fromEntries(keys.map((key) => [key.label, key.runs_served]));
  assert(served["key-1"] === 2 && served["key-2"] === 2 && served["key-3"] === 1, "runs_served");
  const windows = targets.map((target) => {
    const events = byTarget.get(target.id).filter((event) => event.type === "ProbeStarted" || event.type === "ProbeCompleted");
    return { key: target.key, start: events[0].seq, end: events[1].seq };
  });
  for (const row of lines) {
    if (row.event.type !== "ProbeStarted") continue;
    const open = windows.filter((window) => window.start <= row.event.seq && window.end >= row.event.seq);
    const labels = open.map((window) => window.key);
    assert(new Set(labels).size === labels.length, `key overlap at seq ${row.event.seq}`);
    assert(labels.length <= 3, `parallel keys at seq ${row.event.seq}`);
  }
}

function readBack(dir) {
  const ndjson = readFileSync(join(dir, "lab-case.ndjson"), "utf8");
  const lines = ndjson.trimEnd().split("\n").map((line) => JSON.parse(line));
  return {
    lines,
    reports: JSON.parse(readFileSync(join(dir, "lab-reports.json"), "utf8")),
    graph: JSON.parse(readFileSync(join(dir, "lab-graph.json"), "utf8")),
    ledger: JSON.parse(readFileSync(join(dir, "lab-ledger.json"), "utf8")),
    keys: JSON.parse(readFileSync(join(dir, "keys-health.json"), "utf8")),
  };
}

const { lines, graphVersion, reports } = buildReplay();
const graph = buildGraph(reports);
graph.version = graphVersion;
const ledger = ledgerFrom(lines);
const keys = keysHealth();
verify(lines, reports, graph, ledger, keys);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "core", "fixtures");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "lab-case.ndjson"),
  `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
);
writeFileSync(join(outDir, "lab-reports.json"), `${JSON.stringify(reports, null, 2)}\n`);
writeFileSync(join(outDir, "lab-graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
writeFileSync(join(outDir, "lab-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
writeFileSync(join(outDir, "keys-health.json"), `${JSON.stringify(keys, null, 2)}\n`);

const disk = readBack(outDir);
verify(disk.lines, disk.reports, disk.graph, disk.ledger, disk.keys);
console.log(
  `wrote ${disk.lines.length} events, ledger ${disk.ledger.entry_count}, graph v${disk.graph.version}, head ${disk.ledger.head_hash.slice(0, 12)}`,
);
