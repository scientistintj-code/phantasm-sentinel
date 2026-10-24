import { z } from "zod";

const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/);
const idSchema = z.string().min(1);
const seqSchema = z.number().int().positive();

export const PHASES = [
  "init_browser",
  "load_site",
  "bypass_popups",
  "navigate_checkout",
  "collect_evidence",
  "validate_payload",
  "build_graph",
] as const;

export const MODULES = ["search", "fetch", "agent", "vault", "profiles"] as const;

export const INDICATOR_KINDS = [
  "publishable_key",
  "merchant_id",
  "client_id",
  "processor_host",
  "form_action_host",
  "checkout_script_host",
  "descriptor",
  "telegram",
  "email",
  "phone",
  "ip",
  "ns",
  "cert_fingerprint",
  "registrar",
  "domain",
] as const;

export const phaseSchema = z.enum(PHASES);
export const moduleNameSchema = z.enum(MODULES);
export const moduleRunStateSchema = z.enum(["started", "completed", "failed", "skipped"]);
export const indicatorKindSchema = z.enum(INDICATOR_KINDS);
export const indicatorSourceSchema = z.enum(["agent", "infra"]);

export const indicatorSchema = z.object({
  kind: indicatorKindSchema,
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: indicatorSourceSchema,
});

const severitySchema = z.enum(["safe", "medium", "high"]);
const evidenceSourceSchema = z.enum(["agent", "infra", "derived"]);

function evidenceRow<F extends string, L extends string>(field: F, label: L) {
  return z.object({
    field: z.literal(field),
    label: z.literal(label),
    value: z.string(),
    severity: severitySchema,
    source: evidenceSourceSchema,
  });
}

function checkRow<F extends string>(field: F) {
  return z
    .object({
      field: z.literal(field),
      passed: z.boolean(),
      reason: z.string().min(1).optional(),
    })
    .superRefine((row, ctx) => {
      if (row.passed && row.reason !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "reason is present only when passed is false",
          path: ["reason"],
        });
      }
      if (!row.passed && row.reason === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "reason is required when passed is false",
          path: ["reason"],
        });
      }
    });
}

export const targetReportSchema = z.object({
  target_id: idSchema,
  host: idSchema,
  risk: z.object({
    score: z.number().min(0).max(100),
    label: z.enum(["LOW", "MEDIUM", "HIGH"]),
    evidence_coverage: z.string().regex(/^[0-8]\/8$/),
    verdict: z.string().min(1),
  }),
  evidence: z.tuple([
    evidenceRow("merchant_id", "Merchant ID"),
    evidenceRow("gateway", "Gateway"),
    evidenceRow("payment_endpoint", "Payment Endpoint"),
    evidenceRow("host_ip", "Host IP"),
    evidenceRow("domain_age", "Domain Age"),
    evidenceRow("ssl_issuer", "SSL Issuer"),
    evidenceRow("suspicious_scripts", "Suspicious Scripts"),
    evidenceRow("redirect_chain", "Redirect Chain"),
  ]),
});

export const graphSchema = z.object({
  version: z.number().int().nonnegative(),
  nodes: z.array(
    z.object({
      id: idSchema,
      type: z.enum(["domain", "gateway", "merchant", "host", "bank", "contact"]),
      label: z.string().min(1),
      target_id: idSchema.optional(),
    }),
  ),
  edges: z.array(
    z.object({
      a: idSchema,
      b: idSchema,
      weight: z.number().min(0).max(1),
      kind: indicatorKindSchema,
    }),
  ),
  clusters: z.array(
    z.object({
      id: idSchema,
      members: z.array(idSchema),
      confidence: z.number().min(0).max(1),
      explanation: z.string(),
    }),
  ),
  insight: z.string(),
});

export const caseSchema = z.object({
  id: idSchema,
  number: z.string().regex(/^PS-\d{4}-\d{4}$/),
  title: z.string().min(1),
  status: z.enum(["created", "running", "completed", "cancelled"]),
  created_at: isoTimestamp,
});

export const caseListSchema = z.array(caseSchema);

export const createCaseRequestSchema = z.object({
  title: z.string().min(1),
  authorized_by: z.string().min(1),
  authorization_ack: z.literal(true),
});

export const targetAdmissionSchema = z
  .object({
    url: z.string().min(1),
    host: z.string().min(1),
    accepted: z.boolean(),
    reason: z.string().optional(),
  })
  .superRefine((row, ctx) => {
    if (!row.accepted && row.reason === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "rejected URLs include a reason",
        path: ["reason"],
      });
    }
  });

export const targetAdmissionListSchema = z.array(targetAdmissionSchema);

export const addTargetsRequestSchema = z.object({
  urls: z.array(z.string().min(1)).max(10),
});

export const investigateRequestSchema = z.object({
  max_parallel: z.number().int().min(1).max(5).optional(),
  focus: z.string().max(300).optional(),
  use_profiles: z.boolean().optional(),
});

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});

export const keyHealthSchema = z.object({
  label: idSchema,
  state: z.enum(["healthy", "cooling", "exhausted", "invalid"]),
  in_flight: z.number().int().nonnegative(),
  runs_served: z.number().int().nonnegative(),
});

export const keyHealthListSchema = z.array(keyHealthSchema);

export const verifyResultSchema = z.object({
  ok: z.boolean(),
  entries_checked: z.number().int().nonnegative(),
  first_broken_seq: seqSchema.optional(),
  reason: z.string().optional(),
  head_hash: z.string().regex(/^[0-9a-f]{64}$/),
  signature_ok: z.boolean(),
});

const eventRoot = z.object({
  case_id: idSchema,
  seq: seqSchema,
  ts: isoTimestamp,
});

const targetedRoot = eventRoot.extend({
  target_id: idSchema,
});

export const eventEnvelopeSchema = eventRoot.extend({
  type: z.string().min(1),
  target_id: idSchema.optional(),
});

export const KNOWN_EVENT_TYPES = [
  "CaseCreated",
  "TargetQueued",
  "PhaseChanged",
  "ModuleStatus",
  "ReconFinding",
  "ProbeStarted",
  "StreamingUrl",
  "AgentStep",
  "ProbeCompleted",
  "IndicatorExtracted",
  "PayloadValidated",
  "GraphUpdated",
  "PivotSuggested",
  "SafetyHalt",
  "TargetFailed",
  "CaseCompleted",
] as const;

const knownTypeSet = new Set<string>(KNOWN_EVENT_TYPES);

export const caseCreatedEventSchema = eventRoot.extend({
  type: z.literal("CaseCreated"),
  title: z.string().min(1),
});

export const targetQueuedEventSchema = targetedRoot.extend({
  type: z.literal("TargetQueued"),
  url: z.string().min(1),
  host: z.string().min(1),
});

export const phaseChangedEventSchema = targetedRoot.extend({
  type: z.literal("PhaseChanged"),
  phase: phaseSchema,
});

export const moduleStatusEventSchema = targetedRoot.extend({
  type: z.literal("ModuleStatus"),
  module: moduleNameSchema,
  state: moduleRunStateSchema,
  duration_ms: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
});

export const reconFindingEventSchema = targetedRoot.extend({
  type: z.literal("ReconFinding"),
  source: z.enum(["search", "fetch", "infra"]),
  summary: z.string().min(1),
});

export const probeStartedEventSchema = targetedRoot.extend({
  type: z.literal("ProbeStarted"),
  run_id: idSchema,
  key_label: idSchema,
});

export const streamingUrlEventSchema = targetedRoot.extend({
  type: z.literal("StreamingUrl"),
  url: z.string().min(1),
});

export const agentStepEventSchema = targetedRoot.extend({
  type: z.literal("AgentStep"),
  index: z.number().int().nonnegative(),
  purpose: z.string().min(1),
});

export const probeCompletedEventSchema = targetedRoot.extend({
  type: z.literal("ProbeCompleted"),
  status: z.string().min(1),
  reached_checkout: z.boolean(),
  stopped_reason: z.string().min(1),
});

export const indicatorExtractedEventSchema = targetedRoot.extend({
  type: z.literal("IndicatorExtracted"),
  indicator: indicatorSchema,
});

export const payloadValidatedEventSchema = targetedRoot.extend({
  type: z.literal("PayloadValidated"),
  schema_version: z.literal("2.4"),
  checks: z.tuple([
    checkRow("merchant_id"),
    checkRow("gateway"),
    checkRow("payment_endpoint"),
    checkRow("host_ip"),
    checkRow("domain_age"),
    checkRow("ssl_issuer"),
    checkRow("suspicious_scripts"),
    checkRow("redirect_chain"),
  ]),
  report: targetReportSchema,
});

export const graphUpdatedEventSchema = targetedRoot.extend({
  type: z.literal("GraphUpdated"),
  version: z.number().int().nonnegative(),
});

export const pivotSuggestedEventSchema = targetedRoot.extend({
  type: z.literal("PivotSuggested"),
  pivot_id: idSchema,
  indicator: indicatorSchema,
  query: z.string().min(1),
});

export const safetyHaltEventSchema = eventRoot.extend({
  type: z.literal("SafetyHalt"),
  target_id: idSchema.optional(),
  reason: z.string().min(1),
});

export const targetFailedEventSchema = targetedRoot.extend({
  type: z.literal("TargetFailed"),
  error_code: z.string().min(1),
  message: z.string().min(1),
});

export const caseCompletedEventSchema = eventRoot.extend({
  type: z.literal("CaseCompleted"),
  targets: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  clusters: z.number().int().nonnegative(),
});

export const knownEventSchema = z.discriminatedUnion("type", [
  caseCreatedEventSchema,
  targetQueuedEventSchema,
  phaseChangedEventSchema,
  moduleStatusEventSchema,
  reconFindingEventSchema,
  probeStartedEventSchema,
  streamingUrlEventSchema,
  agentStepEventSchema,
  probeCompletedEventSchema,
  indicatorExtractedEventSchema,
  payloadValidatedEventSchema,
  graphUpdatedEventSchema,
  pivotSuggestedEventSchema,
  safetyHaltEventSchema,
  targetFailedEventSchema,
  caseCompletedEventSchema,
]);

const unknownEventSchema = eventEnvelopeSchema
  .superRefine((envelope, ctx) => {
    if (knownTypeSet.has(envelope.type)) {
      ctx.addIssue({
        code: "custom",
        message: `Invalid ${envelope.type} event`,
        path: ["type"],
      });
    }
  })
  .transform((envelope) => ({
    case_id: envelope.case_id,
    seq: envelope.seq,
    ts: envelope.ts,
    target_id: envelope.target_id,
    type: "UnknownEvent" as const,
    originalType: envelope.type,
  }));

export const sentinelEventSchema = z.union([knownEventSchema, unknownEventSchema]);

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const ledgerEntrySchema = z.object({
  seq: seqSchema,
  ts: isoTimestamp,
  event_type: z.string().min(1),
  payload: sentinelEventSchema,
  prev_hash: hashSchema,
  entry_hash: hashSchema,
});

export const ledgerPageSchema = z.object({
  entries: z.array(ledgerEntrySchema),
  next_cursor: z.string().nullable(),
});

export const replayCueSchema = z.object({
  t_ms: z.number().int().nonnegative(),
  event: sentinelEventSchema,
});

export type Indicator = z.infer<typeof indicatorSchema>;
export type TargetReport = z.infer<typeof targetReportSchema>;
export type Graph = z.infer<typeof graphSchema>;
export type CaseRecord = z.infer<typeof caseSchema>;
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;
export type AddTargetsRequest = z.infer<typeof addTargetsRequestSchema>;
export type InvestigateRequest = z.infer<typeof investigateRequestSchema>;
export type TargetAdmission = z.infer<typeof targetAdmissionSchema>;
export type Problem = z.infer<typeof problemSchema>;
export type KeyHealth = z.infer<typeof keyHealthSchema>;
export type VerifyResult = z.infer<typeof verifyResultSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type LedgerPage = z.infer<typeof ledgerPageSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type KnownEvent = z.infer<typeof knownEventSchema>;
export type SentinelEvent = z.infer<typeof sentinelEventSchema>;
export type UnknownEvent = Extract<SentinelEvent, { type: "UnknownEvent" }>;
export type ReplayCue = z.infer<typeof replayCueSchema>;
export type PhaseName = (typeof PHASES)[number];
export type ModuleName = (typeof MODULES)[number];

export function parseSentinelEvent(input: unknown): SentinelEvent {
  return sentinelEventSchema.parse(input);
}

export function parseSentinelEventJson(text: string): SentinelEvent {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SyntaxError("Malformed JSON");
  }
  return parseSentinelEvent(data);
}
