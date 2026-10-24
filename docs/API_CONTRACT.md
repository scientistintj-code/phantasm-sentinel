# API contract

Single source of truth for the Sentinel HTTP API and the console. Both tracks follow this document. Shapes below are normative. Anything TinyFish does not document, and that this file does not decide, is listed under [Open questions](#open-questions).

Prefix every path with `/v1`. The proxy adds `X-Sentinel-Token`. The API treats a missing token as an error. Errors are [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) `application/problem+json`:

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Case not found", "instance": "/v1/cases/…" }
```

Timestamps are ISO-8601 UTC (`2026-10-24T12:00:00.000Z`).

## REST

### Case

```text
GET  /cases
POST /cases   {title, authorized_by, authorization_ack: true}
           -> {id, number 'PS-2026-0001', title, status, created_at}
GET  /cases/{id}
```

`GET /cases` returns a JSON array of those case objects. `number` matches `PS-YYYY-NNNN`. `authorization_ack` must be `true`.

`status`: `created` | `running` | `completed` | `cancelled`.

The console agent pill maps `running` → `RUNNING`, `completed` → `COMPLETE`, and `created` or `cancelled` → `IDLE`.

### Targets

```text
POST /cases/{id}/targets   {urls: string[<=10]}
                        -> [{url, host, accepted, reason?}]
```

At most 10 URLs. `host` is the normalized hostname. A rejected URL sets `accepted: false` and `reason`. The server assigns `target_id` and emits it on `TargetQueued` (the POST body above does not include it). Report and pivot paths use that id.

### Investigate, cancel, approve

```text
POST /cases/{id}/investigate   {max_parallel?: 1-5, focus?: string<=300, use_profiles?: bool}
POST /cases/{id}/cancel
POST /cases/{id}/pivots/{pivot_id}/approve
```

Each returns `202 Accepted` and no JSON body. Progress is observed on the event stream. `focus` is at most 300 characters. `max_parallel` is an integer from 1 to 5.

### Events

```text
GET /cases/{id}/events
```

Server-Sent Events (`text/event-stream`). Each event sets `id` to `seq`. A client resumes with `Last-Event-ID` (the last `seq` it applied). The server replays events with a greater `seq`. A heartbeat comment is sent every 15 seconds and is not an event:

```text
id: 12
data: {"case_id":"…","seq":12,"ts":"2026-10-24T12:00:01.200Z","type":"PhaseChanged","target_id":"tgt_lab_a","phase":"load_site"}

: heartbeat
```

### Report, graph, ledger, keys

```text
GET  /cases/{id}/targets/{target_id}/report   -> TargetReport
GET  /cases/{id}/graph                        -> Graph
GET  /cases/{id}/ledger?cursor=
POST /cases/{id}/ledger/verify                -> {ok, entries_checked, first_broken_seq?, reason?, head_hash, signature_ok}
GET  /health/keys                             -> [{label, state: healthy|cooling|exhausted|invalid, in_flight, runs_served}]
```

`cursor` is the last `seq` the client already has, as a decimal string. Omit it to read from the start. The list response is `{entries, next_cursor}`. `next_cursor` is `null` when nothing remains. `entries` are [ledger entries](#ledger). Verify checks the hash chain and the signed head. On failure `ok` is `false`, `first_broken_seq` is the first bad entry, and `reason` says why. `signature_ok` is independent of chain continuity.

## Events

SSE `data` is one JSON object. Every event has `case_id`, `seq` (monotonic, starts at 1), `ts`, and `type`. `target_id` is present on target-scoped events and omitted on case-scoped events.

| type | fields |
| --- | --- |
| `CaseCreated` | `title` |
| `TargetQueued` | `url`, `host` |
| `PhaseChanged` | `phase`: `init_browser` \| `load_site` \| `bypass_popups` \| `navigate_checkout` \| `collect_evidence` \| `validate_payload` \| `build_graph` |
| `ModuleStatus` | `module`: `search` \| `fetch` \| `agent` \| `vault` \| `profiles`; `state`: `started` \| `completed` \| `failed` \| `skipped`; `duration_ms?`; `summary?` |
| `ReconFinding` | `source`: `search` \| `fetch` \| `infra`; `summary` |
| `ProbeStarted` | `run_id`, `key_label` |
| `StreamingUrl` | `url` |
| `AgentStep` | `index`, `purpose` |
| `ProbeCompleted` | `status`, `reached_checkout`, `stopped_reason` |
| `IndicatorExtracted` | `indicator`: `{kind, value, confidence, source}` with `confidence` in 0..1 and `source`: `agent` \| `infra` |
| `PayloadValidated` | `schema_version`, `checks`: `[{field, passed, reason?}]`, `report`: TargetReport |
| `GraphUpdated` | `version` |
| `PivotSuggested` | `pivot_id`, `indicator`, `query` |
| `SafetyHalt` | `reason` |
| `TargetFailed` | `error_code`, `message` |
| `CaseCompleted` | `targets`, `failed`, `clusters` |

`indicator` on `PivotSuggested` uses the same object as `IndicatorExtracted`.

`PhaseChanged` only moves forward. The backend infers `bypass_popups` and `navigate_checkout` from step text (Agent `purpose`, otherwise step `action`) and never emits an earlier phase after a later one for that target. The seven phases are emitted in the order listed above.

### Console display

Phase labels, in order: Initialize Cloud Browser, Load Site, Bypass Popups, Navigate Checkout, Collect Evidence, Validate Payload, Build Graph.

Module labels: `search` TinySearch, `fetch` TinyFetch, `agent` TinyAgent, `vault` TinyVault, `profiles` TinyProfiles. Descriptions the console shows: discovers mirror and related domains; unpacks dynamic pages into clean JSON; navigates popups and checkout flows; injects test credentials securely; preserves session cookies across runs.

`PayloadValidated.schema_version` is `2.4`. The console badge is `v2.4`. Validation chips are the eight evidence labels, in evidence order. `StreamingUrl` is shown in an iframe; a URL that fails to load (including `https://stream.invalid/…`) must not break the shell.

Risk `label` is `LOW` \| `MEDIUM` \| `HIGH`. The console draws `LOW RISK`, `MEDIUM RISK`, and `HIGH RISK`.

## Indicator kinds

`publishable_key`, `merchant_id`, `client_id`, `processor_host`, `form_action_host`, `checkout_script_host`, `descriptor`, `telegram`, `email`, `phone`, `ip`, `ns`, `cert_fingerprint`, `registrar`, `domain`.

## TargetReport

```text
TargetReport {
  target_id, host,
  risk: {score 0-100, label LOW|MEDIUM|HIGH, evidence_coverage: 'n/8', verdict},
  evidence: [ exactly 8 rows, this order:
    merchant_id, gateway, payment_endpoint, host_ip, domain_age,
    ssl_issuer, suspicious_scripts, redirect_chain
    each {field, label, value, severity: safe|medium|high, source: agent|infra|derived}
  ]
}
```

Labels: Merchant ID, Gateway, Payment Endpoint, Host IP, Domain Age, SSL Issuer, Suspicious Scripts, Redirect Chain.

`evidence_coverage` is `"<passed>/<8>"` where `<passed>` is how many `PayloadValidated.checks` have `passed: true`. Checks use the same eight `field` names, in the same order. `reason` is present only when `passed` is `false`.

## Graph

```text
Graph {
  version,
  nodes: [{id, type: domain|gateway|merchant|host|bank|contact, label, target_id?}],
  edges: [{a, b, weight 0-1, kind}],
  clusters: [{id, members: [target_id], confidence, explanation}],
  insight
}
```

Indicator → node type:

| kinds | type |
| --- | --- |
| `publishable_key`, `merchant_id`, `client_id` | `merchant` |
| `processor_host`, `form_action_host`, `checkout_script_host` | `gateway` |
| `ip` | `host` |
| `descriptor` | `bank` |
| `telegram`, `email`, `phone` | `contact` |

Each target also has a `domain` node with `target_id` set. `ns`, `cert_fingerprint`, `registrar`, and `domain` indicators do not grow extra node types. `weight` is the indicator confidence. `kind` is the indicator kind. One node per `(type, value)`.

Console legend: domain Scam Domain, gateway Payment Gateway, merchant Merchant ID, host Host IP, bank Bank / UPI. `contact` is part of this API; the extracted console legend has no contact swatch.

## Ledger

```text
entry {seq, ts, event_type, payload, prev_hash, entry_hash}
```

`payload` is the event object. Canonical JSON is that value with keys sorted at every object, no whitespace, UTF-8.

```text
entry_hash = hex_sha256(prev_hash + " " + seq + " " + ts + " " + canonical_payload)
```

Hex is lowercase. `seq` is the decimal integer. Genesis:

```text
prev_hash = hex_sha256("phantasm-sentinel:genesis:" + case_id)
```

The signed head is HMAC-SHA256, lowercase hex, over the UTF-8 string `head_hash + " " + entry_count`, keyed with the case ledger secret. `head_hash` is the last `entry_hash`. `entry_count` is the number of entries. Heartbeat comments are not ledger entries.

## Replay file format

NDJSON, one event per line:

```text
{"t_ms": <ms offset from start>, "event": <event>}
```

`t_ms` is an integer offset from the first event. `event` is the SSE object (`case_id`, `seq`, `ts`, `type`, …). Lines are ordered by `seq`.

## Open questions

These depend on `docs/TINYFISH_FACTS.md`. This contract does not invent TinyFish fields.

1. **Stealth and proxy exist on TinyFish and are not on investigate.** Agent accepts `browser_profile` (`lite` | `stealth`, default `lite`) and `proxy_config` (`enabled`, `type` `tinyfish` | `custom`, `country_code`, `url`, `username`, `password`). `POST /cases/{id}/investigate` does not take them. Whether Sentinel forwards stealth or a proxy is undecided. Proxy and stealth surcharges are **NOT DOCUMENTED**.

2. **Profile flag name.** TinyFish uses `use_profile` (boolean) and optional `profile_id` (`profile_id` requires `use_profile: true`). This contract's field is `use_profiles` and has no `profile_id`. Workflow keys cannot use profiles (`403 FORBIDDEN`).

3. **Vault.** `use_vault` (default `false`) and `credential_item_ids` exist. A goal string has no documented credential placeholder. Workflow keys cannot call vault (`403`, `details.reason` `workflow_key_personal_credentials`). Investigate has no vault field; the console still shows TinyVault.

4. **Resume and heartbeats.** Case SSE supports `Last-Event-ID`. TinyFish `POST /v1/automation/run-sse` does not; reconnection is poll `GET /v1/runs/{id}` until `COMPLETED`, `FAILED`, or `CANCELLED`. TinyFish `HEARTBEAT` is an SSE event (`type`, `timestamp`). This contract's heartbeat is a comment every 15s.

5. **Step text used for phases.** SSE `PROGRESS` documents `purpose`, `run_id`, `timestamp`. It does not document an index, so `AgentStep.index` is Sentinel's count. `GET /v1/runs/{id}` step examples show `id`, `timestamp`, `status`, `action`, `screenshot`, `html`, `duration`. A formal step schema is **NOT DOCUMENTED**, so the popup and checkout heuristics may see `purpose` or only `action`.

6. **Probe outcome vs goal outcome.** TinyFish `COMPLETED` means the infrastructure finished, not that the goal succeeded. A failed goal can be `COMPLETED` with `result.status` `"failure"` and `result.reason`. `reached_checkout` is not a TinyFish field. `StreamingUrl.url` maps from documented `streaming_url` (live for 24 hours). `output_schema` is the structured-output field; without that entitlement the run is `403`. Types inside `capture_config` other than `html: true` are **NOT DOCUMENTED**, so TargetReport has no screenshot or recording URL.

7. **Key states.** `healthy` | `cooling` | `exhausted` | `invalid` are Sentinel. TinyFish signals include HTTP 429 (the automation pending-run cap does not set `Retry-After`), 402 `INSUFFICIENT_CREDITS`, 401 invalid key, and HTTP 200 `BILLING_REJECTED` (`BILLING_FAILURE`, terminal status `CANCELLED`). The mapping onto key state is not fixed by the facts. The numeric pending-run cap is **NOT DOCUMENTED**.

8. **Budgets.** `agent_config.max_steps` is beta, range 1–500, default 150. Non-beta requests that send it return `403`. Investigate does not send it. Search `purpose` allows 2000 characters; `focus` here is at most 300. Fetch allows at most 10 URLs, the same cap as `POST /cases/{id}/targets`.
