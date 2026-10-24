import { MODULES, PHASES, type ModuleName, type PhaseName } from "@phantasm/core";

export type StepId = PhaseName | ModuleName;

/** Read-only retrieval and local computation. */
export const PASSIVE_STEPS: readonly StepId[] = [
  "search",
  "fetch",
  "validate_payload",
  "build_graph",
];

/** Browser session, typed credentials, or reused cookies. */
export const ACTIVE_STEPS: readonly StepId[] = [
  "init_browser",
  "load_site",
  "bypass_popups",
  "navigate_checkout",
  "collect_evidence",
  "agent",
  "vault",
  "profiles",
];

const PHASE_LABEL: Record<PhaseName, string> = {
  init_browser: "Initialize Cloud Browser",
  load_site: "Load Site",
  bypass_popups: "Bypass Popups",
  navigate_checkout: "Navigate Checkout",
  collect_evidence: "Collect Evidence",
  validate_payload: "Validate Payload",
  build_graph: "Build Graph",
};

const MODULE_DETAIL: Record<ModuleName, string> = {
  search: "TinySearch. Discovers mirror and related domains.",
  fetch: "TinyFetch. Unpacks dynamic pages into clean JSON.",
  agent: "TinyAgent. Navigates popups and checkout flows.",
  vault: "TinyVault. Injects test credentials securely.",
  profiles: "TinyProfiles. Preserves session cookies across runs.",
};

export interface MethodologyBlock {
  id: string;
  heading: string;
  paragraphs: readonly string[];
  items: readonly string[];
  quote: string | null;
}

function isPhase(id: StepId): id is PhaseName {
  return (PHASES as readonly string[]).includes(id);
}

export function stepLine(id: StepId): string {
  if (isPhase(id)) return `${id} (${PHASE_LABEL[id]})`;
  return `${id}: ${MODULE_DETAIL[id]}`;
}

export function methodologyBlocks(weights: string): MethodologyBlock[] {
  return [
    {
      id: "pipeline",
      heading: "Pipeline",
      paragraphs: [
        "An investigation emits the phases below, in this order. PhaseChanged only moves forward: a later phase is not followed by an earlier phase for the same target.",
        "bypass_popups and navigate_checkout are inferred from the agent step purpose. If purpose is absent, the step action is used. Modules run during that sequence. Their product names below are the ones the console shows.",
      ],
      items: PHASES.map((phase) => stepLine(phase)),
      quote: null,
    },
    {
      id: "activity",
      heading: "Passive and active steps",
      paragraphs: [
        "A step is passive when it only reads a page or computes on data already collected. A step is active when it starts a browser, moves through the page, enters credentials, or reuses a session.",
        "The two lists name every phase and every module once.",
      ],
      items: [
        ...PASSIVE_STEPS.map((id) => `Passive. ${stepLine(id)}`),
        ...ACTIVE_STEPS.map((id) => `Active. ${stepLine(id)}`),
      ],
      quote: null,
    },
    {
      id: "stop",
      heading: "Stop before payment and synthetic identity",
      paragraphs: [
        "The phase list has no payment step. It stops at collect_evidence, validate_payload, and build_graph.",
        "Console focus text tells the agent: Stop before any payment. The console also states: Authorized investigation only. Test credentials only. No real payments.",
        "Synthetic identity is the test credential TinyVault injects. It is not a real customer. Lab storefronts send the response header X-Phantasm-Lab: synthetic. The lab declined page says: This synthetic lab did not process a payment.",
        "A safety stop is recorded as SafetyHalt with a reason. A heartbeat comment is not an event and is not a ledger entry.",
      ],
      items: [],
      quote: null,
    },
    {
      id: "weights",
      heading: "Heuristic risk weights",
      paragraphs: [
        "Evidence severity is safe, medium, or high. The block below is the weight text the dossier quotes from sentinel/graph/risk.py. When that file is missing, the quote is the fallback from the dossier module.",
        "TargetReport.risk.score is an integer from 0 to 100. TargetReport.risk.label is LOW, MEDIUM, or HIGH. The score is a heuristic, not a legal finding. Findings are leads requiring verification.",
      ],
      items: [],
      quote: weights,
    },
    {
      id: "ledger",
      heading: "Ledger",
      paragraphs: [
        "Each entry stores seq, ts, event_type, the event payload, prev_hash, and entry_hash. entry_hash is lowercase hex SHA-256 of prev_hash, a space, the decimal seq, a space, ts, a space, and the canonical payload. Canonical JSON sorts keys at every object, uses no whitespace, and is UTF-8.",
        "The first prev_hash is hex SHA-256 of the UTF-8 string phantasm-sentinel:genesis: plus the case id. The signed head is HMAC-SHA256, lowercase hex, over head_hash, a space, and the entry count, keyed with the case ledger secret. head_hash is the last entry_hash.",
        "Verify checks the hash chain and the signed head. When the chain breaks, ok is false and first_broken_seq is the first bad entry. signature_ok is independent of chain continuity.",
        "The stored log is tamper-evident. It is not court-ready. A matching chain shows the stored entries still hash together and the signed head still matches. It does not prove the events happened, that the pages were authentic, or that a court should accept the file. The ledger screen's tamper control changes only the displayed copy.",
      ],
      items: [],
      quote: null,
    },
    {
      id: "limits",
      heading: "Limitations",
      paragraphs: [
        "These bounds are the ones the API contract and the case file implement.",
      ],
      items: [
        "A case accepts at most 10 target URLs.",
        "evidence_coverage counts how many of the eight payload checks passed, written as n/8. A passed check is not proof the value is true.",
        "The risk label is only LOW, MEDIUM, or HIGH. A cluster stores members, a confidence from 0 to 1, and an explanation string. Both the score and the explanation are leads.",
        "TinyFish COMPLETED means the automation finished, not that the goal succeeded. reached_checkout is not a TinyFish field.",
        "TargetReport has no screenshot or recording URL. A streaming URL that fails to load, including an invalid host, is not a finding.",
        "Investigate accepts max_parallel from 1 to 5, an optional focus of at most 300 characters, and use_profiles. It does not send stealth, a proxy, vault credential ids, or a profile id.",
        "Workflow keys cannot use profiles or vault.",
      ],
      quote: null,
    },
  ];
}
