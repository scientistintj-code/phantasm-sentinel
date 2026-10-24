# TinyFish facts

Verified only from `docs/TINYFISH_DOCS.txt`. Each fact ends with the heading it came from. Anything that file does not state is **NOT DOCUMENTED**.

## 1. Agent API

Base URL `https://agent.tinyfish.ai`. Canonical paths are `POST /v1/automation/run`, `POST /v1/automation/run-async`, and `POST /v1/automation/run-sse`. (`Agent API` / `Canonical Endpoints`; `Agent API Reference` / `Endpoints`)

Auth header is `X-API-Key`. REST uses an API key; MCP uses OAuth 2.1. (`Agent API` / `Before You Start`; `Authentication` / `REST API Authentication`)

All three automation endpoints accept the same JSON body. (`Agent API Reference` / `Common Request Body`)

| Field | Type | Optional | Notes |
| --- | --- | --- | --- |
| `url` | `string` | no | Target URL. |
| `goal` | `string` | no | Natural-language instruction. |
| `output_schema` | `object` | yes | Structured-output schema. Unsupported fields rejected before execution. |
| `browser_profile` | `lite \| stealth` | yes | Default `lite`. `stealth` is the anti-detection browser. |
| `proxy_config.enabled` | `boolean` | yes | Enables proxying. |
| `proxy_config.type` | `tinyfish \| custom` | yes | Default `tinyfish`. `custom` requires your proxy URL. |
| `proxy_config.country_code` | `string` | yes | ISO 3166-1 alpha-2. Used with `type: "tinyfish"`. Default `US`. |
| `proxy_config.url` | `string` | yes | Required when `type` is `custom`. |
| `proxy_config.username` | `string` | yes | Custom proxy username. |
| `proxy_config.password` | `string` | yes | Custom proxy password. |
| `agent_config.mode` | `default \| strict` | yes | Beta. `strict` stops instead of exploring workarounds. |
| `agent_config.max_steps` | `integer` | yes | Beta. 1–500. Omit for EVA default 150. Non-beta requests that send it return `403 FORBIDDEN`. |
| `agent_config.max_duration_seconds` | `integer` | yes | Wall-clock cap. Default: no limit. |
| `webhook_url` | `string` | yes | HTTPS URL for lifecycle notifications. Must use `https://`. |
| `capture_config` | `object` | yes | Opt-in artifacts: `screenshots`, `recording`, `html`, `snapshots`, `elements`. Account-gated; `403` if a capability is not enabled. |
| `use_profile` | `boolean` | yes | Use the default Browser Context Profile. |
| `profile_id` | `string` | yes | Specific profile. Requires `use_profile: true`. |
| `use_vault` | `boolean` | yes | Enable vault credentials. Default `false` (`Vault Credentials` / `Parameters`). |
| `credential_item_ids` | `string[]` | yes | Credential URIs from `GET /v1/vault/items`. Requires `use_vault: true`. Omit to expose all synced items. |

(`Agent API Reference` / `Common Request Body`, except the `use_vault` default)

`capture_config.html: true` is required for per-step HTML snapshots. Example value is boolean `true`. Types of `screenshots`, `recording`, `snapshots`, and `elements`: **NOT DOCUMENTED**. (`Agent Endpoints` / `Common Request Options`; `Agent API Reference` / `Common Request Body`)

`proxy_config.type: "custom"` without the custom-proxy entitlement returns `403 FORBIDDEN`. (`Error Codes` / `FORBIDDEN`)

`Proxies` / `Supported Countries` lists `US`, `GB`, `CA`, `DE`, `FR`, `JP`, `AU`. `Anti-Bot Guide` / `Add a proxy` says `country_code` accepts any ISO 3166-1 alpha-2 and that the SDK enum covers common ones. Whether the seven-country table is exhaustive: **NOT DOCUMENTED**.

`/run` returns the final result and cannot be cancelled. Response fields: `run_id` `string \| null`, `status` `COMPLETED \| FAILED`, `started_at` `string \| null`, `finished_at` `string \| null`, `num_of_steps` `number \| null`, `result` `object \| null`, `error` `object \| null`. (`Agent API Reference` / `` `POST /v1/automation/run` ``)

`/run-async` returns `run_id` `string \| null` and `error` `object \| null` immediately. Fetch later with `GET /v1/runs/{id}`. Cancel supported. (`Agent API Reference` / `` `POST /v1/automation/run-async` ``)

`/run-sse` returns an SSE stream. Cancel supported. Reconnection via `Last-Event-ID` is not supported; poll `GET /v1/runs/{run_id}` until `COMPLETED`, `FAILED`, or `CANCELLED`. (`Agent API Reference` / `` `POST /v1/automation/run-sse` ``)

A JSON object result is returned directly. A bare list or plain text arrives under `result.result`. (`Agent API` / `What Success Looks Like`)

## 2. SSE event types

| Event | Documented fields |
| --- | --- |
| `STARTED` | `type`, `run_id`, `timestamp` |
| `STREAMING_URL` | `type`, `run_id`, `streaming_url`, `timestamp` |
| `PROGRESS` | `type`, `run_id`, `purpose`, `timestamp` |
| `HEARTBEAT` | `type`, `timestamp` |
| `COMPLETE` | `type`, `run_id`, `status`, `result` (optional), `error` (optional), `timestamp`. On failure, `error` carries `help_url` and `help_message`. |

(`Agent API Reference` / `` `POST /v1/automation/run-sse` ``)

`STREAMING_URL` is a live browser URL valid 24 hours. `HEARTBEAT` is a keep-alive. `COMPLETE` includes `status` and `result`. (`Agent Endpoints` / `Event Types`)

Other SSE event types or extra fields: **NOT DOCUMENTED**.

## 3. Run lifecycle

Statuses: `PENDING` (queued), `RUNNING` (browser executing), `COMPLETED` (finished; check `result`), `FAILED` (infrastructure error), `CANCELLED` (manually stopped). (`Runs` / `Run Lifecycle`)

`COMPLETED` means the infrastructure worked, not that the goal succeeded. A goal failure can still be `COMPLETED` with `result.status` `"failure"` and `result.reason`. (`Runs` / `Understanding COMPLETED Status`)

Fetch one run: `GET /v1/runs/{id}`. Fields: `run_id` `string`, `status` `PENDING \| RUNNING \| COMPLETED \| FAILED \| CANCELLED`, `goal` `string`, `created_at` `string`, `started_at` `string \| null`, `finished_at` `string \| null`, `num_of_steps` `integer \| null`, `result` `object \| null`, `error` `object \| null`, `profile_attached` `boolean`, `profile_id` `string \| null`, `streaming_url` `string \| null`, `browser_config` `object \| null`, `video_url` `string \| null`, `output_schema` `object \| null`, `steps` `array`. Both profile fields are omitted when an organization workflow key reads a run that used a profile. (`Agent API Reference` / `` `GET /v1/runs/{id}` ``)

`error` fields: `code` `string`, `message` `string`, `category` `SYSTEM_FAILURE \| AGENT_FAILURE \| BILLING_FAILURE \| UNKNOWN`, `retry_after` `number \| null`, `help_url` `string`, `help_message` `string`. On the Runs page, `code`, `help_url`, and `help_message` are optional. (`Agent API Reference` / `` `GET /v1/runs/{id}` ``; `Runs` / `The Error Object`)

`browser_config` contains `proxy_enabled` and `proxy_country_code`. `video_url` is a presigned recording URL, `null` when none, expiring after 15 minutes. `streaming_url` is available while the run is active. (`Runs` / `The Run Object`; `Runs` / `Watching Runs Live`)

List: `GET /v1/runs`. Query: `status`, `goal` (case-insensitive partial), `created_after`, `created_before`, `sort_direction` `asc \| desc` (default `desc`), `cursor`, `limit` 1–100 (default 20). Response: `data` array plus `pagination.total`, `pagination.next_cursor`, `pagination.has_more`. (`Runs` / `Searching and Filtering Runs`)

Cancel: `POST /v1/runs/{id}/cancel`. Only `/run-async` and `/run-sse` runs. Dashboard and `/run` runs cannot be cancelled. Only `PENDING` or `RUNNING` runs are stopped. Idempotent. Response: `run_id` `string`, `status` `CANCELLED \| COMPLETED \| FAILED`, `cancelled_at` `string \| null`, `message` `string \| null`. Cancelled: status `CANCELLED`, timestamp, `message` `null`. Already cancelled: `CANCELLED`, timestamp, `"Run already cancelled"`. Already finished: `COMPLETED`, `cancelled_at` `null`, `"Run already finished"`. (`Agent API Reference` / `` `POST /v1/runs/{id}/cancel` ``; `Runs` / `Cancelling Runs`)

Steps are always on `GET /v1/runs/{id}`. Step fields in the example: `id`, `timestamp`, `status`, `action`, `screenshot`, `html`, `duration`. (`Runs` / `Retrieving Steps and Screenshots`)

`screenshots` query: `url` (default, absolute URL), `base64` (`data:image/jpeg;base64,...`, temporary), `none` (`screenshot` is `null`). `html` query: `url` (default) or `none`. Per-step `html` is non-null only if the run used `capture_config.html: true`. (`Runs` / `Retrieving Steps and Screenshots`)

`GET /v1/runs/{id}/steps/{stepId}/html` returns raw HTML, only if `capture_config.html: true`. `GET /v1/runs/{id}/steps/{stepId}/screenshot` returns JPEG bytes. `screenshots=url` URLs are session-auth paths `/runs/{id}/steps/{stepId}/screenshot`. (`Get step HTML snapshot`; `Get step screenshot`)

A formal schema for every step field beyond the example: **NOT DOCUMENTED**.

## 4. Search API and Fetch API

**Search.** `GET https://api.search.tinyfish.ai`. Header `X-API-Key`. (`Search API`; `Search API Reference` / `Endpoint`)

Query parameters: `query` `string` required; `purpose` `string` optional, max 2000 characters; `location` `string`; `language` `string`; `include_domains` `string` (comma-separated); `exclude_domains` `string`; `recency_minutes` `number` integer 1–5256000; `after_date` `string` `YYYY-MM-DD`; `before_date` `string` `YYYY-MM-DD`; `domain_type` `string` `"web"` (default), `"news"`, or `"research_paper"`; `pub_year_min` / `pub_year_max` `number` integers 0–9999, research papers only; `page` `number` from 0, max 10. (`Search API Reference` / `Parameters`)

`site:` / `-site:` in `query` still work and are deprecated in favor of `include_domains` / `exclude_domains`. Do not combine `recency_minutes` with `after_date` or `before_date`. If both dates are sent, `after_date` must be `<=` `before_date`. Date and recency filters are not supported for `research_paper`. If only one of `location` or `language` is set, the other auto-resolves; if neither, `US` and `en`. (`Search API Reference` / `Parameters`; `Search API` / `Freshness and Date Filters`)

Response: `query` `string`, `results` `object[]`, `total_results` `number`, `page` `number`. Result fields: `position` `number` (1-indexed), `site_name` `string`, `title` `string`, `snippet` `string`, `url` `string`, `date` `string` (news and some web), `publisher` `string` (news), `authors` `string[]`, `venue` `string`, `year` `number`, `cited_by_count` `number`, `pdf_url` `string` (academic, when a PDF exists). (`Search API Reference` / `Response`)

Search is free up to 12,000 requests/day, reset 00:00 UTC. Default rate limit 30 requests/minute per API key; over limit returns HTTP 429. (`Search API`; `Search API Reference` / `Rate Limits`; `Search API Reference` / `Billing`)

Usage list: `GET /usage` on the search OpenAPI host. Returns paginated records with query details, status, and result counts. Query and item schema: **NOT DOCUMENTED**. (`List search usage`)

`Error Codes` / `RATE_LIMIT_EXCEEDED` names the limited path `/v1/search`. Whether that path is an alias of `https://api.search.tinyfish.ai`: **NOT DOCUMENTED**.

**Fetch.** `POST https://api.fetch.tinyfish.ai`. Header `X-API-Key`. Up to 10 URLs. `http` or `https` only. Private IPs, localhost, and cloud metadata hosts are rejected. (`Fetch API`; `Fetch API Reference` / `Endpoint`; `Fetch API Reference` / `Parameters`)

Body fields: `urls` `string[]` required; `purpose` `string` optional, non-empty, max 2000; `format` `string` default `markdown`, one of `html`, `markdown`, `json`; `links` `boolean` default false; `image_links` `boolean` default false; `iframe_links` `boolean` default false; `ttl` `integer` omit = any cache, `0` = live, positive = max cache age in seconds; `per_url_timeout_ms` `integer` 1–110000; `if_none_match` `string` single URL only; `if_modified_since` `string` single URL only; `include_etag_and_last_modified` `boolean` default false; `include_selectors` `string[]` 1–20 entries, each 1–1000 characters; `exclude_selectors` `string[]` same bounds; `highlights` `object` beta, requires `format: "markdown"`. (`Fetch API Reference` / `Parameters`)

`highlights.query` `string` required; `highlights.max_snippets` `integer` default 5, range 1–20; `highlights.max_characters` `integer` 100–20000; `highlights.include_full_page_text` `boolean` default false. Accounts not in the beta get `403 FORBIDDEN`. (`Fetch API Reference` / `Parameters`)

Response: `results` and `errors`. Result fields: `url`, `final_url`, `title` `string \| null`, `description` `string \| null`, `language` `string \| null`, `author` `string \| null`, `published_date` `string \| null`, `text` `string \| object \| null`, `links` `string[]` (only if requested), `image_links` `string[]`, `iframe_links` `string[]`, `not_modified` `boolean` optional, `etag` `string` optional, `last_modified` `string` optional, `unmatched_selectors` `string[]` optional, `highlights` `object[]` optional (`text` `string`, `rank` `integer` from 1), `latency_ms` `number \| null`, `format` `string`. (`Fetch API Reference` / `Response`)

`errors[]`: `url` `string`, `error` `string`, optional `status` `number`, optional `unmatched_selectors` `string[]`, optional `candidate_selectors` `string[]` (max 10). Per-URL failures stay in `errors[]` on HTTP 200. (`Fetch API Reference` / `` `errors[]` ``; `Fetch API` / `Fetching Multiple URLs`)

`error` codes: `target_http_error`, `page_not_found`, `target_unreachable`, `timeout`, `bot_blocked`, `empty_content`, `login_required`, `content_too_large`, `invalid_url`, `invalid_redirect_url`, `proxy_error`, `conditional_unsupported`, `selector_not_matched`, `selector_unsupported`. Generic documents 20MB; PDF and CSV 50MB. Per-URL backend timeout 110 seconds. Batch CDN ceiling 120 seconds. (`Fetch API Reference` / `Error Codes`)

Free up to 1,000 successfully fetched URLs/day, reset 00:00 UTC. Default 150 URLs/minute per API key; over limit returns HTTP 429. (`Fetch API`; `Fetch API Reference` / `Billing`; `Fetch API Reference` / `Rate Limits`)

Usage: `GET https://api.fetch.tinyfish.ai/usage`. Query: `start_after`, `end_before`, `status` `completed \| failed`, `limit` 1–1000 default 100, `page` default 1. Response: `items`, `total`, `limit`, `page`, `total_pages`, `has_more`. (`Fetch API Reference` / `Usage Endpoint`)

HTTP errors for the fetch request itself: `400`, `401`, `402`, `403`, `422` (bad CSS), `429`, `500`, `503`. (`Fetch API Reference` / `Error Codes`)

## 5. Vault

Credentials stay in the connected password manager (1Password or Bitwarden). TinyFish syncs items and caches them. `GET /v1/vault/items` reads that cache. Provider tokens are encrypted at rest and are not stored in plaintext. Secret values are resolved at the browser layer, held in memory only for the input action, then discarded. The agent sees labels and field names only. Values do not appear in prompts, logs, screenshots, or streaming output. (`Connect Your Vault` / `How It Works`; `Connect Your Vault` / `List vault items`; `Vault Credentials` / `Security`)

Connect: `POST /v1/vault/connections`. 1Password body: `provider` `"1password"`, `token` (service account token starting with `ops_`). Bitwarden: `provider` `"bitwarden"`, `clientId`, `clientSecret`, `masterPassword`, optional `serverUrl`. Invalid credentials return `400`. Same provider is replaced, not duplicated. (`Connect Your Vault` / `Connect Your Provider`)

A goal string has no documented credential placeholder syntax. **NOT DOCUMENTED** inside `goal`. Reference them on the run: `use_vault: true`, and optionally `credential_item_ids` set to `itemId` values from `GET /v1/vault/items`. Examples: `cred:conn-abc:Work:item-123`, `cred:a1b2c3d4-5678-90ab-cdef-1234567890ab:Personal:item-xyz`. A formal URI grammar: **NOT DOCUMENTED**. (`Vault Credentials` / `Using the API`; `Connect Your Vault` / `List vault items`)

Matching is by domain (`linkedin.com` matches `www.linkedin.com` and `login.linkedin.com`). Items with no websites sync but have no `domains` and cannot match. Runs use credential state from start time. (`Vault Credentials` / `Domain Matching`; `Connect Your Vault` / `List vault items`; `Vault Credentials` / `FAQ`)

`credential_item_ids` without `use_vault: true` is rejected. Workflow keys cannot use `use_vault` or vault endpoints: `403 FORBIDDEN`, `details.reason` `"workflow_key_personal_credentials"`. (`Vault Credentials` / `Troubleshooting`; `Vault Credentials` / `Limitations`)

## 6. Browser Context Profiles

These save cookies, local storage, and session storage. They are not `browser_profile` (`lite` / `stealth`). (`Browser Context Profiles`)

Create: `POST https://agent.tinyfish.ai/v1/profiles` with `X-API-Key`. Body: `name` `string` required, 1–100 characters; `set_as_default` `boolean` optional; `proxy_country_code` `string \| null` optional (`null` means no profile proxy). Response includes `id`, `name`, `proxy_country_code`, `fingerprint_seed`, `created_at`. (`Browser Context Profiles API` / `Create a profile`)

Setup: `POST /v1/profiles/{profileId}/setup-session`. Example body: `url`, `timeout_seconds`. Response: `session_id`, `cdp_url`, `base_url`, `timeout_seconds`, `expires_at`. Connect Playwright, Puppeteer, or CDP to `cdp_url`. Use `base_url` only for TinyFish HTTP session endpoints such as `/pages`. Full setup-session field schema: **NOT DOCUMENTED** beyond that example and response. (`Browser Context Profiles API` / `Set up a profile`; `Create a profile setup session`)

Save: `POST /v1/profiles/{profileId}/save` with `{ "session_id": "..." }`. Cancel: `POST /v1/profiles/{profileId}/setup-session/cancel` with `session_id`. Unsaved state is discarded at `expires_at` or on cancel. (`Browser Context Profiles API` / `Set up a profile`; `Browser Context Profiles API` / `Save, cancel, or time out`)

Reference from a run: `"use_profile": true` for the default profile, or both `"use_profile": true` and `"profile_id": "prof_..."` for a specific one. `profile_id` without `use_profile: true` is invalid. `use_profile: true` with no default profile returns `400`. (`Browser Context Profiles API` / `Run with a Browser Context Profile`; `Browser Context Profiles API` / `API setup lifecycle`)

Manual upload: `POST /v1/profiles/{profileId}/upload`. Limits: 5 MB payload, 3,000 cookies, 100 domains. Cookie example fields: `name`, `value`, `domain`. (`Browser Context Profiles API` / `Upload cookies manually`)

You cannot delete the only active profile. Workflow keys cannot use profiles. (`Browser Context Profiles` / `Manage Browser Context Profiles`; `Browser Context Profiles` / `Limits and expectations`)

## 7. Structured output

The Agent API accepts a JSON schema. The exact field name is `output_schema`. (`Structured Output`; `Agent API Reference` / `Common Request Body`)

Top level must be a JSON object (`type` if present must be `object`). Top-level `anyOf` is not supported. Serialized schema max 64KB. Max depth 10. Boolean schema nodes `true` / `false` are not supported. Use `nullable: true`, not a `type` array. (`Structured Output` / `Top-Level Constraints`)

Allowed keywords: `anyOf`, `enum`, `format`, `items`, `maxItems`, `maximum`, `minItems`, `minimum`, `nullable`, `properties`, `propertyOrdering`, `required`, `type`. Types: `object`, `array`, `string`, `number`, `integer`, `boolean`. `format` values: `date`, `date-time`, `duration`, `time`. Rejected examples: `oneOf`, `additionalProperties`, `const`, `example`, `examples`. Invalid schemas return HTTP `400` before execution. (`Structured Output` / `Supported Types`; `Supported Keywords`; `Important Rules`; `Example Errors`)

`output_schema` without the output-schema entitlement returns `403 FORBIDDEN`. (`Error Codes` / `FORBIDDEN`)

When the schema and the goal disagree, the schema wins. (`Structured Output` / `The Schema Is the Contract`)

## 8. Errors and rate limits

API-level errors are non-2xx with `error.code`, `error.message`, optional `error.details`, and usually top-level `request_id` matching `X-Request-ID`. Run-response errors are HTTP 200 inside the run `error` object. (`Error Codes` / `Error Response Format`; `Error Codes` / `Run-response Error Codes`)

| HTTP | Codes |
| --- | --- |
| 200 | Run body: `SERVICE_BUSY`, `TIMEOUT`, `BILLING_REJECTED`, `CONTENT_POLICY_VIOLATION`, `MAX_STEPS_EXCEEDED`, `SITE_BLOCKED`, `TASK_FAILED`, `CANCELLED` |
| 400 | `INVALID_INPUT`, `UNKNOWN_ROUTE` |
| 401 | `MISSING_API_KEY`, `INVALID_API_KEY`, `UNAUTHORIZED`, `VAULT_RECONNECT_REQUIRED` |
| 402 | `INSUFFICIENT_CREDITS`, `FREE_ALLOWANCE_EXHAUSTED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND`, `FEATURE_NOT_AVAILABLE` (`GET /v1/wallet` on legacy billing), `UNKNOWN_ROUTE` |
| 409 | `RETRY_REQUIRED` |
| 429 | `RATE_LIMIT_EXCEEDED` |
| 500 | `INTERNAL_ERROR` |
| 502, 504 | `BACKEND_UNAVAILABLE` |
| 503 | `SERVICE_BUSY`, `BACKEND_UNAVAILABLE` |

(`Error Codes` / `HTTP Status Code Summary`)

`DAILY_LIMIT_EXCEEDED` is HTTP 429 and no current endpoint returns it. (`Error Codes` / `DAILY_LIMIT_EXCEEDED`)

Automation `/v1/automation/run`, `/run-async`, and `/run-batch` use a pending-run cap tied to the account concurrency limit. That 429 does not set `Retry-After` or `X-RateLimit-*`. The numeric cap: **NOT DOCUMENTED** (the body includes the current count and the maximum). (`Error Codes` / `RATE_LIMIT_EXCEEDED`)

Search and Fetch set `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `X-Request-ID`. Account per-minute 429s include `details.limit`, `details.unit` (`requests` or `urls`), `details.window_seconds`, and `details.upgrade_url` (absent for an organization shared limit). Missing `details` means retry, not upgrade: upstream throttle, pending-run cap, or 60/minute combined usage reads and invalid requests. (`Error Codes` / `RATE_LIMIT_EXCEEDED`)

**Credits exhausted.** Wallet accounts: HTTP 402 `INSUFFICIENT_CREDITS` before the run is created. Not retryable until money is added. `details.reason` `"wallet_out_of_funds"`, plus `balance`, `currency`, `wallet_url`, `minimum_top_up`, `auto_reload_needs_payment_fix`, and `agent_top_up_url` when an agent payment can unblock it. A run already in progress finishes even if the balance goes negative. The next run is denied. (`Error Codes` / `INSUFFICIENT_CREDITS (wallet accounts)`)

Legacy credit/subscription accounts: HTTP 403 `FORBIDDEN` when credits are gone or the subscription expired. Example message: insufficient credits, 0 remaining. (`Error Codes` / `FORBIDDEN`)

The same billing rejection can arrive as HTTP 200 `BILLING_REJECTED`, category `BILLING_FAILURE`, terminal status `CANCELLED`, no steps. (`Error Codes` / `BILLING_REJECTED`)

Search, Fetch, and Research return 402 `INSUFFICIENT_CREDITS` when the daily free allowance is used and the wallet is zero or below. Allowances: 12,000 Search requests, 1,000 Fetch URLs, 2 Research runs, reset 00:00 UTC. Body is only `code` and `message`. If the product does not charge the wallet, the code is `FREE_ALLOWANCE_EXHAUSTED` and adding funds does not help. (`Error Codes` / `INSUFFICIENT_CREDITS (wallet accounts)`; `Error Codes` / `FREE_ALLOWANCE_EXHAUSTED (metered products)`)

`GET /v1/wallet` on a legacy account returns 404 `FEATURE_NOT_AVAILABLE`. (`Error Codes` / `FEATURE_NOT_AVAILABLE`)

## 9. Pricing and credit notes

MCP listed rates: `search` $0.00 per request, `fetch_content` $0.00 per URL, `run_web_automation` $0.016 per step, `create_browser_session` $0.002 per browser-minute, `create_monitor` $0.005 per completed run plus its Search or Fetch. Failed monitor runs are free. Legacy credit plans bill 1 credit per step and 1 credit per 4 browser-minutes. (`MCP Integration` / `Rates`)

Search and Fetch are free inside the daily allowances above, then need a positive wallet balance. (`Search API Reference` / `Billing`; `Fetch API Reference` / `Billing`)

Agent and Browser draw from the wallet, or plan credits on legacy accounts. (`Authentication` / `MCP Authentication`; `MCP Integration` / `Authentication`)

`agent_config.max_steps` bounds cost: lower it to fail fast. Default 150, range 1–500, beta. (`Runs` / `Max Steps`)

Minimum wallet top-up is $10. (`Error Codes` / `INSUFFICIENT_CREDITS (wallet accounts)`)

Research: first 2 completed runs per UTC day are free; then `deep` is $2 and `max` is $3 per completed run. Failed, timed-out, and cancelled runs are not charged. Default concurrency 5. Admission is at start; charge is at completion; in-flight runs are not stopped and can take the balance below zero. (`Research API Reference` / `Limits`)

Monitors: $0.005 per completed run, plus one Search or Fetch that counts toward that daily allowance. (`Monitor` / `Pricing`)

Organization monthly spend cap resets on the 1st (UTC). Stopping at the cap is best-effort, usually within minutes. Spend counts contract prices before prepaid credits. Per-member and per-key limits do not stop usage. If the organization cannot pay, the request is refused and does not fall back to a personal wallet. (`Organizations` / `Spend limits and alerts`; `Organizations` / `Who pays`)

Per-step dollar price outside the MCP rates table, and proxy or stealth surcharges: **NOT DOCUMENTED**.
