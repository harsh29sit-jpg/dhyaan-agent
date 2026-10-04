---
artifact_type: implementation_plan
plan_id: PLAN-DHYAAN-MCP-001
title: Dhyaan MCP Server Implementation Plan
status: in_progress
revision: 1
approved_revision: 1
approval:
  state: approved
execution:
  state: blocked
  executing_revision: 1
risk_level: high
plan_depth: large/cross-cutting
source_specs:
  - attachments/PRD_1.md
primary_references:
  - attachments/PRD_1.md
  - "Confirmed request: Gmail and Razorpay payments inside the same MCP server, connected to the master agent on AgenticOrg."
other_references:
  - PRD (1).md
dependencies:
  - AgenticOrg owner account and connector registration access
  - Google OAuth consent and dedicated Gmail mailbox
  - Google Sheets workbook and service account
  - Meta WhatsApp Cloud API credentials and test recipients
  - Gnani account and verified speech API contracts
  - Razorpay test account and signed webhook configuration
  - Neon Postgres and public HTTPS deployment
open_questions:
  - id: OPEN-01
    text: Verify AgenticOrg Streamable HTTP, bearer authentication, scheduler interval, and connector limits.
    owner: Platform owner
  - id: OPEN-02
    text: Obtain organiser acceptance of MCP-wrapped services and Razorpay replacing the mandated Pine Labs rail.
    owner: Competition team lead
  - id: OPEN-03
    text: Obtain missing companion API contracts and freeze verified Delhivery and Gnani payloads.
    owner: Integration developer
  - id: OPEN-04
    text: Accept payer-completed Razorpay test links as the demo payment flow; delegated autopay is not established.
    owner: Product owner
  - id: OPEN-05
    text: Resolve the dedicated plans destination with the system path helper, unavailable in the local runtime.
    owner: Documentation runtime owner
acceptance_criteria:
  - id: AC-01
    text: A configuration evidence table distinguishes configured, missing, and verified services without disclosing secrets.
  - id: AC-02
    text: Authenticated MCP discovery exposes the frozen allowlist, including Gmail and Razorpay, but no admin or decision-making tools.
  - id: AC-03
    text: Signed WhatsApp messages are deduplicated, leased, acknowledged safely, and support voice, text, buttons, templates, and window errors.
  - id: AC-04
    text: Sheets state mutations validate schema and versions, remain replay-safe, and support decision audit and three-part completion evidence.
  - id: AC-05
    text: Gmail reads real messages and threads, resumes safely by message identity, and sends idempotent fallback email with least-privilege OAuth.
  - id: AC-06
    text: Razorpay test links are replay-safe and never count as paid until captured funds, amount, currency, and journey linkage are verified.
  - id: AC-07
    text: Delhivery REST and MCP contracts preserve partner fields and raw failures, persist shipment state, and isolate scenario administration.
  - id: AC-08
    text: All calls have redacted correlated audit evidence; uncertainty after external side effects never triggers blind duplicate sends or payments.
  - id: AC-09
    text: The AgenticOrg master agent alone applies policy and recovery, completes the happy path with three evidence items, and safely handles all PRD exception and human variants.
validation_strategy:
  - id: VAL-01
    validates: [AC-01]
    method: Inspect redacted setup evidence and execute per-service authentication smoke checks; unresolved access is recorded as blocked, not passed.
  - id: VAL-02
    validates: [AC-02, AC-08]
    method: Run authenticated MCP client discovery and calls; compare tool schemas with frozen contracts and inspect redacted logs.
  - id: VAL-03
    validates: [AC-03]
    method: Execute webhook signature, duplicate delivery, lease expiry, acknowledgement ownership, media, and 24-hour window tests.
  - id: VAL-04
    validates: [AC-04]
    method: Execute Sheets schema, concurrent update, replay, journal recovery, and evidence completeness tests against an isolated workbook.
  - id: VAL-05
    validates: [AC-05]
    method: Execute Gmail pagination, MIME decoding, duplicate-event, revoked-token, and uncertain-send tests; read and send synthetic live mail.
  - id: VAL-06
    validates: [AC-06, AC-08]
    method: Execute Razorpay amount conversion, signature, duplicate webhook, event ordering, partial payment, mismatch, and uncertain-create tests; complete a test link.
  - id: VAL-07
    validates: [AC-07]
    method: Validate REST and MCP responses against verified Delhivery fixtures, including NDR, no rider, timeout, and malformed body.
  - id: VAL-08
    validates: [AC-02, AC-09]
    method: Run AgenticOrg registration and end-to-end evaluations with real test services; archive all runs and prompt versions.
steps:
  - id: STEP-01
    title: Establish service prerequisites and external contract gates
    agent: GeneralistAgent
    container: all
    depends_on: []
    acceptance: [AC-01]
    validation: [VAL-01]
    recovery: Keep setup evidence redacted; revoke accidental authorisations and rotate exposed credentials; never activate live payments.
    status: failed
  - id: STEP-02
    title: Implement the single Dhyaan MCP application
    agent: CodeWritingAgent
    container: dhyaan_mcp
    depends_on: [STEP-01]
    acceptance: [AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08]
    validation: [VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07]
    recovery: Use an isolated database branch and additive migrations; reconcile uncertain external calls before retry; redeploy the previous build without deleting audit records.
    status: to_do
  - id: STEP-03
    title: Add independent contract and failure-path tests
    agent: TestCodeWritingAgent
    container: dhyaan_mcp
    depends_on: [STEP-02]
    acceptance: [AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08]
    validation: [VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07]
    recovery: Reset only synthetic fixtures and isolated provider resources; preserve failure evidence; do not reset the shared demo database.
    status: to_do
  - id: STEP-04
    title: Verify deployed services and integrate the AgenticOrg master agent
    agent: TestExecutionAgent
    container: all
    depends_on: [STEP-03]
    acceptance: [AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09]
    validation: [VAL-01, VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07, VAL-08]
    recovery: Disable demo schedules before rollback, release expired leases, reconcile captured test payments, and restore the previous connector and prompt revision.
    status: to_do
revision_history:
  - revision: 1
    change: Initial PRD-based plan with confirmed same-server Gmail and Razorpay scope; approval and live-service setup remain unverified.
---

[CodeWiki](../../index.md) / [Artifacts](../index.md) / [Implementation Plans](index.md)

# Dhyaan MCP Server Implementation Plan

## Outcome and boundaries

Build one self-hosted `dhyaan_mcp` application containing WhatsApp, Gnani voice, Google Sheets state, Gmail, Razorpay test payments, Delhivery-compatible mocks, and a private scenario API. The master agent on AgenticOrg remains the only decision-maker. The server performs validated mechanics and returns evidence or structured errors; it does not interpret medical intent, select pharmacies, apply ACT/ASK/STOP, grant approvals, or autonomously recover journeys.

The confirmed request overrides the PRD's native Gmail and Pine Labs connector split. Register the MCP and the native Agent Scheduler; do not register duplicate native Gmail or payment flows for this scope. This is a user-approved provider selection, not proof of organiser approval. Razorpay payment links require payer interaction and do not implement the PRD's delegated-autopay mandate. Real money, clinical advice, medicine substitution, OCR, travel booking, a custom user frontend, and additional agents are excluded.

The requester approved revision 1 (“Approve plan and implement”) and instructed execution of STEP-01 on 2026-10-04. This authorizes the described implementation scope, including payer-completed test links, but does not establish organiser approval, delegated autopay, configured credentials or live-service readiness. STEP-01 captured prerequisite evidence; application implementation remains STEP-02.

## Current architecture and evidence

The supplied work item reports no running containers, no project definition, and no container environment variables. A local directory inventory found only `PRD (1).md` and an empty `assets/` directory. No application package, source tree, tests, Docker configuration, `.env`, or repository metadata was found in that inventory. No container runtime was queried, so this is workspace and work-item evidence, not a machine-wide claim that no containers exist.

The attachment reader supplied the full 1,111-line PRD at `attachments/PRD_1.md`; a bounded read of the physical PRD showed the same version and section structure, without establishing byte equality. KnowledgeTools returned documentation scaffold and sample artifacts, not a Dhyaan implementation. The PRD's architecture coverage labels saying “Built” are intended coverage, not verified implementation status.

The PRD-referenced work distribution, external API specs, MCP contract, and platform notes were not present in the local inventory. They are missing inputs, not existing source links. Future file paths below are explicit proposed creation targets.

The mandatory implementation-plan path helper could not be imported: `code_generation_core_agent` is unavailable in the local Python runtime. Its source was also unavailable through the attempted file read. Placement at `kavia-docs/CodeWiki/Artifacts/Plans/` is provisional pending OPEN-05, not a verified helper result. The implementation-plan skill owns the Markdown artifact contract; this is not a Spec Builder execution blueprint or JSON-backed specification.

## Proposed change overview

### Shared design decisions

| ID | Decision | Consequence |
| --- | --- | --- |
| DEC-01 | Use one Node.js 22 LTS ESM application with Express, TypeScript, MCP SDK, zod, pino, googleapis, pg, Vitest, and Supertest. | Node 22 is a proposed update to the PRD's Node 20 baseline; lock exact dependency versions during implementation. No local LLM dependency is needed. |
| DEC-02 | Use stateless Streamable HTTP at `/mcp` with bearer authentication and an explicit public-origin allowlist. | Verify compatibility on AgenticOrg before freezing registration; no invented platform invocation endpoint. |
| DEC-03 | Use one always-on application container, Neon Postgres, and private external object storage for temporary audio. | Supports ffmpeg if needed and avoids local-memory persistence. This deliberately replaces the PRD's default Vercel deployment, subject to organiser hosting acceptance. |
| DEC-04 | Keep care state in Google Sheets and server mechanics in Postgres. | Serialize agent runs and Sheet writes; prohibit manual edits to source tabs during runs. Family View is read-only. |
| DEC-05 | Use a dedicated Gmail account with `gmail.readonly` and `gmail.send` OAuth scopes. | OAuth belongs to the server, not native AgenticOrg Gmail. Poll through agent runs; no Pub/Sub prerequisite. |
| DEC-06 | Use Razorpay test Payment Links with no partial payments and no provider SMS/email notifications. | The agent explicitly sends the link through WhatsApp or Gmail. No inferred autopay, live keys, stored card data, or refund capability in this scope. |
| DEC-07 | Implement only extra X-1 pharmacy stock/price initially. | At most three extras are permitted; omit speculative rider and voice entity tools until separately approved. Intent/entity reasoning stays in the agent. |
| DEC-08 | Persist side-effect operations before external dispatch and return uncertainty rather than blindly retry. | Local idempotency is not a provider exactly-once guarantee. The same key with changed arguments is a conflict. |
| DEC-09 | Treat received WhatsApp text and Gmail content as untrusted data, never instructions. | Prompt injection cannot authorize payments, reveal secrets, or change the agent's rules. |

Neon stores inbox leases, outbox operations, payment mappings, webhook events, audio references, Sheet-write journals, mock rail state, scenarios, and redacted call logs. It is a managed dependency, not a second application container. Gmail, Razorpay, Meta, Gnani, Sheets, and object storage are external services.

Every tool dispatch attaches a correlation `request_id`, validated `run_id`, connector identity, argument digest, latency, result code, and `real_service`. Own tools use `{ok,data,error,request_id,replayed}`; rail tools use `{http_status,body,parse_error}`. Never normalize a malformed rail reply into success. HTTP/OAuth clients must not perform hidden action retries; access-token refresh is credential maintenance, not a repeated business action.

### Required service configuration

All entries are **required and unverified** unless later evidence establishes otherwise. Names not stated literally in the PRD are proposed configuration names, not discovered environment variables. Never put values in this plan, chat, committed files, tool outputs, or logs.

| Service | Required configuration names | Setup and verification |
| --- | --- | --- |
| Application | `NODE_ENV`, `PORT`, `PUBLIC_BASE_URL`, `MCP_API_KEY`, `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `UPSTREAM_TIMEOUT_MS` | Proposed port 3000. Public HTTPS and reverse proxy; distinct MCP/admin secrets; explicit origin validation, body limits, and rate limits. |
| Postgres | `DATABASE_URL` | Provision Neon project and isolated test branch; verify TLS, migration privileges, and connection-pool limits. |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | Meta app/test number; recipients enrolled; permanent system-user token before recording; subscribe `/webhooks/whatsapp`; approved templates; pin supported Graph version. |
| Gnani | `GNANI_API_KEY_ID`, `GNANI_BASE_URL` | Verify account and `X-API-Key-ID` authentication; test `/stt/v3` and `/api/v1/tts/inference`; verify OGG/Opus input and compatible TTS output. |
| Sheets | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_SPREADSHEET_ID` | Enable Sheets API, share dedicated workbook with service-account email, seed synthetic rows and read-only Family View; store JSON only in secret management. |
| Gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN` | Enable Gmail API; configure consent screen and test user; one-time owner OAuth consent with offline access and exact redirect URL. Service-account Sheets credentials do not grant consumer Gmail access. |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYMENTS_MODE` | Require `PAYMENTS_MODE=test` and test-key identity; create separate test webhook at `/webhooks/razorpay`; subscribe captured, failed, and link-paid events as applicable. Reject live mode. |
| Private audio storage | `AUDIO_S3_ENDPOINT`, `AUDIO_S3_BUCKET`, `AUDIO_S3_ACCESS_KEY_ID`, `AUDIO_S3_SECRET_ACCESS_KEY`, `AUDIO_S3_REGION` | Proposed private S3-compatible bucket, limited prefix permissions, one-hour object expiry, no public ACL; verify deletion lifecycle. |
| Delhivery mock | `DELHIVERY_MOCK_TOKEN` | Separate REST credential; authenticated requests and persistent synthetic seed data. No real Delhivery credentials are required. |
| AgenticOrg | Platform-side MCP URL and bearer credential; owner account, connector identity, scheduler binding | Register one URL `/mcp`; verify private-connector ownership, tool discovery, scope checks, limits, and manual run first. No platform API key or URL is invented. |

External authorization necessarily requires the identified service owner. Document absence honestly; no credential placeholders should be treated as configured. Local contract tests can proceed using explicit test doubles after the draft revision is approved, but live checks cannot pass without owner setup.

## Execution steps

### STEP-01 — Establish service prerequisites and external contract gates

**Owner:** GeneralistAgent. **Container:** all. ❌ Status: failed. **Dependencies:** none.

**Objective:** Turn known external uncertainties into redacted setup records and frozen integration inputs. **Definition of done:** Every required service has a named owner, configuration state, and verification outcome, and unresolved architecture or competition gates are explicitly recorded.

**Technical approach:** Apply DEC-02 — verified MCP transport, DEC-03 — selected container hosting, DEC-05 — Gmail OAuth, and DEC-06 — Razorpay test links. The platform owner must verify bearer-header registration, scheduler interval, timeout/retry semantics, and connector scope. The competition lead must resolve wrapped-service, hosting, and payment-provider acceptance. The integration developer must obtain official Gnani/Delhivery examples before asserting partner compatibility. Do not block recording this evidence merely because a credential is missing.

| Proposed file/component | Concrete change | Integration impact | Acceptance/validation |
| --- | --- | --- | --- |
| `dhyaan_mcp/docs/service-setup.md` | Record names only, responsible owners, configured/missing/verified states, redirect/webhook paths, and sanitized smoke evidence. | Authoritative setup record; no implied credentials. | AC-01 / VAL-01 |
| `dhyaan_mcp/docs/platform-notes.md` | Record owner, model settings, transport/auth discovery, scope behavior, timeout, rate limit, and scheduler interval. | Resolves platform assumptions before discovery freezes. | AC-01 / VAL-01 |
| `dhyaan_mcp/contracts/provider-fixtures/` | Obtain sanitized official Gnani and Delhivery payload examples with source URL/version metadata. | These are new evidence targets, not currently existing companions. | AC-01 / VAL-01 |

Safe recovery is to revoke accidental consent, rotate any exposed credentials, and retain sanitized evidence. AC-01 — configuration truth is verified through VAL-01 — setup inspection and service smoke checks.

#### Implementation Tracker

- [x] Record each service state and owner in `docs/service-setup.md`.
  - [x] Record all ten service categories, accountable owner roles, missing local configuration and blocked smoke outcomes without secret values.
  - [ ] Service owners confirm actual people, secret bindings and authenticated smoke outcomes.
- [x] Resolve or explicitly block OPEN-01 transport/auth and OPEN-02 competition acceptance in `docs/platform-notes.md`.
  - [x] Separate public platform guidance from tenant proof; record exact registration, scope, limits and scheduler checks.
  - [x] Record competition acceptance as blocked with team-lead action; do not infer organiser consent.
- [ ] Obtain official Gnani/Delhivery fixtures for OPEN-03 and confirm payer-completed payment semantics for OPEN-04.
  - [x] Capture sanitized official Gnani STT/TTS examples with source/date/version metadata.
  - [x] Confirm Razorpay payer-completion, integer paise, captured evidence, unique 40-character reference, standard-link test mode and documented 30-link test quota.
  - [x] Record requester approval of revision 1; payer-completed links remain explicitly distinct from delegated autopay.
  - [ ] Obtain exact official Delhivery success/failure exports and missing companion contracts before partner contract freeze.
  - [ ] Verify actual Gnani OGG/Opus intake/TTS playback and complete one captured payer test payment.
- [ ] Capture VAL-01 evidence without secrets and reconcile OPEN-05 plan placement through the system helper.
  - [x] Capture dated document/inventory evidence, service-specific blocked outcomes and redacted continuation guidance.
  - [ ] Execute provider authentication smoke checks after owner setup.
  - [ ] Resolve canonical plan placement through the unavailable system helper.

#### Outcome and continuation guidance

Evidence records: [service setup](../../../../dhyaan_mcp/docs/service-setup.md), [platform gates](../../../../dhyaan_mcp/docs/platform-notes.md), and [provider fixture provenance](../../../../dhyaan_mcp/contracts/provider-fixtures/README.md). AC-01's truthful configuration register is established; VAL-01 live checks are blocked, not passed. STEP-01 is `failed` because official Delhivery fixtures, live prerequisite verification and helper reconciliation cannot be completed with supplied access; completed evidence work is preserved.

**Instructions for future agent:** Accountable owners must provide protected provider/platform access, exact Delhivery exports and written organiser acceptance as detailed in the platform register. The documentation runtime owner must supply the internal path helper; local `code_generation_core_agent` availability probe returned false on 2026-10-04. Retain this explicitly requested path and stable plan ID meanwhile. Owner roles are assigned responsibilities, not verified account holders.

STEP-02 may proceed with approved offline mechanics and explicit test doubles, fail-closed unconfigured adapters and tests; it must report STEP-01's dependency as unresolved, not mark it passed. Do not freeze Delhivery/OpenAPI partner responses or platform transport compatibility until OPEN-03/OPEN-01 evidence arrives. No live/provider/competition acceptance may be claimed. Gnani STT clips are documented at most 60 seconds; no confidence/duration fields are documented in success examples. Map MCP `language_code` mechanically to TTS provider `language`; parse successful TTS as binary, use explicit reviewed voice/model and test OGG Opus playback. Keep hidden action retries disabled. Use standard Razorpay test links with notifications and reminders off; never use live keys to bypass unsupported test UPI links. Actual secret insertion, one-time Gmail consent and payer completion require the identified owners.

### STEP-02 — Implement the single Dhyaan MCP application

**Owner:** CodeWritingAgent. **Container:** dhyaan_mcp. **Status:** to_do. **Dependencies:** STEP-01.

**Objective:** Implement all mechanical capabilities in one application and expose stable contracts to the agent. **Definition of done:** The application builds, starts with explicit configuration reporting, exposes the contracted authenticated tools, persists mechanical state, and safely fails unconfigured or uncertain operations.

**Technical approach:** All paths in this step are proposed new files beneath `dhyaan_mcp/`; there is no existing application to patch. Implement the following dependency order inside the one container step: bootstrap/contracts, database and audit, state/queue primitives, external adapters, rail mocks, deployment and agent assets. Do not split these into separate application containers.

| Proposed file/component and symbol | Concrete change or resulting shape | Integration impact | Acceptance/validation |
| --- | --- | --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `.env.example`, `Dockerfile` | Pin ESM TypeScript build, `build`, `start`, `lint`, `test`, `test:integration`, `test:mcp` scripts; ignore secrets; multi-stage non-root container with ffmpeg available. | Node 22 proposal; one public service on port 3000; no frontend or local LLM. | AC-01, AC-02 / VAL-01, VAL-02 |
| `src/config.ts`, `src/app.ts`, `src/server.ts`, `src/mcp/server.ts`, `src/mcp/registry.ts`, `src/mcp/schemas.ts` | `loadConfig`, `createApp`, authenticated MCP SDK transport, frozen tool allowlist, public liveness and redacted readiness; raw webhook routes before JSON middleware. | Missing optional adapter credentials return `NOT_CONFIGURED`; missing core auth/DB fails readiness. | AC-02, AC-08 / VAL-02 |
| `src/db/pool.ts`, `src/db/migrate.ts`, `migrations/001_core.sql`, `migrations/002_mock_rails.sql` | Parameterized SQL and additive migrations for PRD mechanical tables plus `provider_operations`, `gmail_inbox`, `gmail_send_operations`, `razorpay_links`, `razorpay_payments`, `provider_webhook_events`, `audio_objects`, `sheet_row_versions`, `sheet_write_operations`, `agent_run_leases`. | Unique external identities and logical operation keys; migrations never erase recordings. Omit unused Pine Labs mock tables. | AC-03 through AC-08 / VAL-03 through VAL-07 |
| `src/lib/idempotency.ts`, `src/lib/audit.ts`, `src/lib/http.ts`, `src/lib/errors.ts` | `executeOnce` reserves `(tool,key)` plus digest, stores result or `OUTCOME_UNKNOWN`; redacted audit in `finally`; bounded upstream timeout with retry disabled. | Replay successful results; same key/different body returns `CONFLICT`; every invocation, including replay/error, is logged. | AC-08 / VAL-02, VAL-06 |
| `src/routes/whatsapp-webhook.ts`, `src/adapters/whatsapp.ts`, `src/tools/whatsapp.ts` | Verify setup token and raw-body HMAC; deduplicate `wamid`; `FOR UPDATE SKIP LOCKED` queue claim; lease-bound acknowledgements; send text/buttons/template/audio; compute 24-hour window. | Closed free-form window returns `WINDOW_CLOSED`; the server never autonomously sends a fallback. | AC-03 / VAL-03 |
| `src/adapters/gnani.ts`, `src/lib/audio-store.ts`, `src/tools/voice.ts` | Download Meta media only through allowlisted provider metadata; bounded size/duration; validated local ffmpeg conversion when needed; STT/TTS; opaque one-hour audio references in private storage. | No fabricated confidence; no media URLs/tokens in results; reference expiry is explicit. | AC-03, AC-08 / VAL-03 |
| `src/adapters/sheets.ts`, `src/tools/state.ts`, `src/lib/sheet-journal.ts`, `src/tools/run.ts` | Typed tab schemas from PRD §6.1, row versions, write-ahead journal, per-workbook serialization, decision-rule validation, single active agent-run lease. | Sheets remains care-state source; no generic range/query tools, no Family View writes or autonomous care decisions. | AC-04 / VAL-04 |
| `src/adapters/gmail.ts`, `src/tools/gmail.ts`, `src/lib/mail-mime.ts` | Dedicated OAuth refresh client; list/search/get/thread; MIME decoding; durable leased message intake and acknowledgements; RFC message composition and idempotent sends. | Readonly+send scopes; no delete/mark-read scopes; mail is external data, not a trusted instruction. | AC-05 / VAL-05 |
| `src/adapters/razorpay.ts`, `src/tools/payments.ts`, `src/routes/razorpay-webhook.ts` | Test-only link creation/fetch/cancel, payment fetch, reconciliation, signed event inbox, exact paise conversion and correlation evidence. | No charge initiation from stored cards or mandate claims; receipt evidence only after captured full payment. | AC-06 / VAL-06 |
| `src/mocks/delhivery.ts`, `src/mocks/scenarios.ts`, `src/mocks/pharmacy.ts`, `src/routes/delhivery.ts`, `src/routes/admin.ts`, `src/tools/rails.ts` | Verified six Delhivery routes and MCP wrappers, persistent scans/waybills/NDR, X-1 stock lookup, exact raw failures and protected scenario controls. | REST `Authorization: Token`; admin `X-Admin-Token`; reset never purges Gmail, payments, audit, or external resources. | AC-07 / VAL-07 |
| `contracts/mcp-tools.json`, `contracts/rule-ids.json`, `contracts/openapi/delhivery.yaml`, `scripts/mcp-smoke.ts` | Machine-readable tool catalog and rule IDs derived from PRD; OpenAPI based on STEP-01 fixtures; authenticated smoke client. | Re-register AgenticOrg if names or schemas change; no admin tools. | AC-02, AC-07 / VAL-02, VAL-07 |
| `agent/system-prompt/v001.txt`, `agent/system-prompt/CHANGELOG.md`, `README.md` | Versioned single-master-agent instructions and local/deployment usage; provider override and unsupported autopay stated plainly. | Binding maps Gmail/Razorpay through the MCP; schedule remains native. | AC-09 / VAL-08 |

**Tool contract additions and clarifications.** Retain all six PRD WhatsApp tools, both voice tools, four state tools, six Delhivery tools, and `pharmacy_stock_lookup`. Add the tools below. Freeze exact zod schemas in the proposed catalog before registration; do not expose OAuth, scenario, reset, direct SQL, or policy-decision tools.

| Tool/interface | Required input and behavior | Output or invariant |
| --- | --- | --- |
| `run_acquire`, `run_release` | Validated `run_id`; acquire one active run lease. Renewal uses `run_acquire` with the current `lease_id`, matching owner, and a bounded extension before expiry; require matching owner on release. | `lease_id`, expiry, or `RUN_BUSY`; expired leases cannot renew; never start an agent run. |
| `wa_get_new_messages`, `wa_ack_messages` | Add `run_id`/`lease_id` to the PRD claim and acknowledgement contracts; bound limits. | Only owning active lease can acknowledge; crash returns messages after five minutes. |
| `state_append`, `state_update`, `state_log_decision` | Require `run_id`, valid lease, and `idempotency_key`; update also requires `expected_version`. | Reject wrong schemas/rules and stale rows. Added keys deliberately fix incomplete PRD write-idempotency coverage. |
| `gmail_read_inbox` | `query`, `limit`, `page_token` optional; `run_id`, `lease_id` required; import stable Gmail IDs into durable inbox and claim unprocessed messages. | Leased sanitized messages plus opaque pagination; no implicit processed mark. |
| `gmail_search_emails` | Bounded `query`, `limit`, optional `page_token`. | Message/thread IDs and metadata; provider pagination preserved. |
| `gmail_get_message`, `gmail_get_thread` | `message_id` or `thread_id`; bounded payload. | Decoded plain text and metadata; attachments not downloaded by default. |
| `gmail_ack_messages` | `message_ids`, `run_id`, `lease_id`; only after care-event commit. | Processed identity persisted; no global “last ID” shortcut that can lose mail. |
| `gmail_send_email` | `to`, `subject`, `body_text`, optional `thread_id`, `idempotency_key`. | Gmail message/thread IDs, replay flag, or explicit uncertain-send error. |
| `razorpay_create_payment_link` | `journey_id`, `task_id`, `order_ref`, positive whole `amount_inr`, `currency=INR`, `idempotency_key`; minimal nonmedical reference. | Raw rail result and provider link identity; no inference that link creation is payment. |
| `razorpay_get_payment_link`, `razorpay_cancel_payment_link` | `payment_link_id`; cancellation additionally requires `idempotency_key`. | Raw provider status; cancel does not refund already captured funds. |
| `razorpay_get_payment` | `payment_id`. | Raw provider payment object, including status, amount, currency and order linkage. |
| `payment_reconcile` | `journey_id`, `task_id`, `payment_link_id`, `payment_id` when known. | Evidence with verified amount/currency/linkage/captured status or a mismatch/unknown result; never applies ACT/ASK/STOP. |

`razorpay_*` tools follow the raw rail contract. The hosted payment link is an intentional user-facing artifact, not a secret media URL; only an allowlisted Razorpay payment URL may be returned for explicit agent delivery. No callback URL supplied by the agent is fetched.

**Persistence and recovery mechanics.** `provider_operations` records payload digests and `RESERVED`, `DISPATCHED`, `SUCCEEDED`, `FAILED`, or `OUTCOME_UNKNOWN`. Enforce a unique payment operation on `(journey_id,task_id)` independently of supplied idempotency keys; a new key cannot silently create a second payment link. After an uncertain Razorpay create, reconcile using the provider reference before any retry. Do not assume the provider supports a generic idempotency header for Payment Links. Cancel or expire an unpaid link before an explicitly approved replacement. A paid operation is never recreated.

Gmail send uses a stable RFC `Message-ID` and local operation record. A timeout after dispatch is not a safe retry: search/reconcile Sent mail where possible, otherwise return uncertainty for owner review. Exactly-once delivery cannot be claimed from local unique keys alone. WhatsApp has the same dispatch-boundary uncertainty; never issue a second send blindly.

Sheets does not provide database-style compare-and-swap. An active single-run lease, Postgres row locks/version records, and a journal serialize writes through this server. Persist intent before the Google write; after a crash inspect deterministic row IDs and hashes before replay. A changed backing row fails as `CONFLICT`. Detect external edits by hash; abort instead of overwriting. Business changes carry event/decision references and replay-safe audit IDs; recovery from a partly written batch is mechanical, not a care decision. Protected source tabs and a no-manual-edit rule are required for the concurrency guarantee.

Razorpay raw-body signature validation uses its webhook secret, not the API key secret. Persist and deduplicate provider event IDs; if absent, use a stable event digest. Do not assume event order. Webhooks only record mechanical evidence and never ship medicine or close a journey. Reconciliation fetches provider status and checks captured full amount, INR currency, link/order association, and server-owned journey/task mapping. `authorized`, link `created`, partial, pending, unverifiable, or mismatched results are not paid. Provider IDs and verified capture data constitute receipt evidence, not a forged PDF or invented signature.

The master-agent prompt must record policy before issuing a payment action, verify approval sender/current status/exact amount, ignore late duplicates, and keep clinical safety separate from financial authorization. Clinical decisions cannot move into the MCP under the guise of validation. Missing linked approval or evidence remains a failed agent evaluation, not silently inferred consent.

Safe recovery follows DEC-08 — persistent uncertain operations. Use additive migrations and isolated synthetic seeds; rollback code without discarding provider mappings, audit logs, or care state. Acceptance AC-02 through AC-08 maps to VAL-02 through VAL-07 as shown above.

#### Implementation Tracker

- [ ] Create build/configuration files, authenticated registry, and frozen schemas for AC-02.
- [ ] Implement migrations, call audit, run leases, and uncertain-side-effect records for AC-08.
- [ ] Implement WhatsApp/Gnani/private audio and prove queue/window invariants for AC-03.
- [ ] Implement Sheets journal, schema validation, row versions, and decision recording for AC-04.
- [ ] Implement Gmail leased event intake and safe send reconciliation for AC-05.
- [ ] Implement Razorpay test links, signed events, correlation, and captured-payment evidence for AC-06.
- [ ] Implement Delhivery/scenarios/X-1, deployment assets, and single-agent prompt; run the build and tool smoke checks.

### STEP-03 — Add independent contract and failure-path tests

**Owner:** TestCodeWritingAgent. **Container:** dhyaan_mcp. **Status:** to_do. **Dependencies:** STEP-02.

**Objective:** Verify contracts and non-happy paths independently of the application author. **Definition of done:** Deterministic automated tests cover all tool families, security boundaries, concurrency, and uncertain side effects without requiring real credentials for the default suite.

**Technical approach:** Extend the single application test suite, using mocked external HTTP only in explicit offline tests and real isolated Postgres for integration tests. Tests must not replace real-service acceptance evidence. DEC-08 — uncertain operations, DEC-09 — untrusted content, and the captured-payment distinction are mandatory regression boundaries.

| Proposed file/component | Concrete tests | Integration impact | Acceptance/validation |
| --- | --- | --- | --- |
| `tests/mcp.test.ts`, `tests/security.test.ts`, `tests/audit.test.ts` | SDK initialize/list/call, bad bearer, invalid Origin, body limits, invalid arguments, no admin tools, same-key conflicts, redaction, injection-as-data. | Compares runtime list to frozen catalog; never broadens permissions for tests. | AC-02, AC-08 / VAL-02 |
| `tests/whatsapp.test.ts`, `tests/voice.test.ts` | Raw signature tampering, redelivery, concurrent claim, wrong-owner ack, expiry, window boundary, buttons, media expiry, unsupported audio, TTS fallback signal. | One row per message, no fabricated transcript confidence or leaked URL. | AC-03 / VAL-03 |
| `tests/sheets.test.ts`, `tests/run-lease.test.ts` | Tab allowlist, invalid rule/enum, concurrent updates, hash conflict, crash after Google write, audit recovery, three-evidence omission matrix. | Explicitly demonstrates limitations on manual external edits. | AC-04 / VAL-04 |
| `tests/gmail.test.ts` | Multi-page mail, nested MIME/base64url, duplicate IDs, unknown patient data, OAuth revocation, lease retry, ambiguous send outcome. | Marks processed only after event commit; does not trust subject/body instructions. | AC-05 / VAL-05 |
| `tests/payments.test.ts`, `tests/razorpay-webhook.test.ts` | INR-to-paise boundary, test-mode rejection of live keys, forged signatures, duplicate/out-of-order events, authorized vs captured, partial/mismatched receipts, alternate keys for one task, timeout after dispatch. | Never tests with real money or labels provider-test failures as live behavior. | AC-06, AC-08 / VAL-06 |
| `tests/delhivery.test.ts`, `tests/scenarios.test.ts`, `tests/integration/`, `tests/fixtures/` | Verified partner fixtures, wrong auth, duplicate order, NSZ/Embargo, no rider, NDR max attempts, low-balance payment fixture, timeout, literal malformed bytes; Postgres durability. | Payment failure fixtures are tests, not a mocked substitute for live Gmail/Razorpay in the demo. | AC-07 / VAL-07 |

Safe recovery resets only test-owned rows and synthetic resources. AC-02 through AC-08 are verified by VAL-02 through VAL-07; do not mark tests as passed merely because they were authored.

#### Implementation Tracker

- [ ] Add registry/security/audit tests and execute VAL-02.
- [ ] Add WhatsApp, voice, and Sheets lease/journal tests for VAL-03 and VAL-04.
- [ ] Add Gmail pagination/MIME/revocation/uncertainty tests for VAL-05.
- [ ] Add Razorpay captured-evidence and duplicate-side-effect tests for VAL-06.
- [ ] Add verified Delhivery and persistent-database tests for VAL-07.

### STEP-04 — Verify deployed services and integrate the AgenticOrg master agent

**Owner:** TestExecutionAgent. **Container:** all. **Status:** to_do. **Dependencies:** STEP-03.

**Objective:** Prove the server can be used by the master agent with real test services. **Definition of done:** Automated checks, provider smoke tests, platform discovery, and required agent journeys have recorded outcomes; unresolved service access or competition acceptance is explicitly reported rather than claimed passed.

**Technical approach:** Deploy the application with its secret store and TLS, apply migrations to an isolated Neon branch first, then perform real-service smoke tests. The platform owner registers the single MCP and native scheduler. Bind the versioned prompt to the existing master agent, or create the single Dhyaan master agent if none exists; do not introduce a second reasoning agent. This owner action is external configuration, not a fabricated platform API operation.

The prompt's run sequence is `run_acquire` → re-read care state → claim WhatsApp and Gmail events → resolve and decide in the agent → log decisions and perform authorized mechanics → commit event/state → acknowledge each handled input → inspect due tasks → `run_release`. Renew a bounded lease if needed; overlapping scheduled/manual runs must refuse concurrent mutation. Scheduler cadence is the verified minimum, targeting one-minute demo polling only if supported. Use the PRD's proposed three-minute reminder and six-minute timeout with Daughter as backup, subject to owner confirmation.

The agent checks all three completion artifacts separately: verified captured payment receipt, Delhivery Delivered scan, and correct-medicine confirmation from the patient/family. Bank emails, screenshots, successful link creation, and “order placed” are never substitutes. Synthetic medicine prices must consistently exercise INR 1,500 and INR 1,850 boundaries.

| Evidence target or external surface | Concrete verification | Acceptance/validation |
| --- | --- | --- |
| `dhyaan_mcp/artifacts/verification/` | Build/lint/unit/contract/integration reports, redacted readiness and migration results, real WhatsApp/STT/TTS/Sheets/Gmail/Razorpay test evidence. | AC-01 through AC-08 / VAL-01 through VAL-07 |
| AgenticOrg MCP registration and scheduler | Exact `/mcp` URL, bearer auth, same owner as master agent, discovered names/schemas equal frozen catalog, no admin functions; measure connector budget and timeout. | AC-02, AC-09 / VAL-08 |
| `dhyaan_mcp/evals/runs/`, versioned prompt history | Run PRD E01–E10 plus happy path, cost-exactly-limit, expired Rx, forged approval, duplicate/late reply, closed-window/email fallback, and prompt-injection checks. Retain failures and changes. | AC-09 / VAL-08 |
| Recording and decision-table exports | Main complete run plus Reject and Late variants; each decision mapped to valid rule, tool, true service, exact words, and evidence. | AC-09 / VAL-08 |

E08's “balance too low” is an evaluation fixture, not a promise that Razorpay test links expose a delegated wallet balance. Real Razorpay tests must cover supported failure modes and captured status. If competition requirements demand a Pine Labs mandate, the Razorpay implementation cannot be relabeled as equivalent.

Disable schedules before rollback. Restore the previous prompt/connector revision, retain logs, reconcile provider operations, and let inbox leases expire safely. Report individual blocked live validations when service owners cannot supply access; do not mark the whole application verified.

#### Implementation Tracker

- [ ] Execute build, lint, tests, database integration, and SDK discovery with captured evidence.
- [ ] Verify real WhatsApp, Gnani, Sheets, Gmail, and a payer-completed Razorpay test link.
- [ ] Register and verify the single MCP binding and scheduler under the master-agent owner.
- [ ] Run E01–E10 and safety/receipt/approval boundary evaluations on AgenticOrg.
- [ ] Preserve all prompt versions, failed/successful logs, and decision-table exports; record main, Reject, and Late runs.

## Acceptance and verification matrix

Commands below are **planned script contracts**, not commands available or executed in the current PRD-only workspace. Run them from `dhyaan_mcp/` after STEP-02 creates the scripts. Set `CI=true`; integration commands require an isolated configured database and workbook, not production resets.

| Acceptance | Observable result | Validation | Method or planned command | Expected evidence |
| --- | --- | --- | --- | --- |
| AC-01 | Truthful service states and verified access where available | VAL-01 | Setup inspection and provider-by-provider smoke calls | Names-only table; pass/blocked outcomes, owner, timestamp |
| AC-02 | Frozen authenticated tool list, no admin or decision tool | VAL-02 | `CI=true npm run build`; `CI=true npm run lint`; `CI=true npm run test:mcp` | Build/lint pass; SDK schemas equal catalog; unauthorized calls rejected |
| AC-03 | Reliable WhatsApp/voice mechanics | VAL-03 | `CI=true npm test -- tests/whatsapp.test.ts tests/voice.test.ts` and real phones | Duplicate/lease/signature/window tests and playable Hindi audio |
| AC-04 | Replay-safe, audited Sheet updates | VAL-04 | `CI=true npm test -- tests/sheets.test.ts tests/run-lease.test.ts`; isolated workbook smoke | Stale write rejected; journal resumes once; no false COMPLETE |
| AC-05 | Real safe Gmail event intake and fallback send | VAL-05 | `CI=true npm test -- tests/gmail.test.ts`; synthetic mailbox smoke | Stable IDs, proper MIME text, one event, revoked token refused |
| AC-06 | Captured test payment evidence, no duplicate pay | VAL-06 | `CI=true npm test -- tests/payments.test.ts tests/razorpay-webhook.test.ts`; test-link completion | Signature/correlation checks; pending is not paid; one logical operation |
| AC-07 | Exact verified mock contracts and isolated scenarios | VAL-07 | `CI=true npm test -- tests/delhivery.test.ts tests/scenarios.test.ts`; `CI=true npm run test:integration` | Fixture/schema match; persistent waybill; raw malformed bytes; restricted reset |
| AC-08 | Redacted audit and side-effect uncertainty safety | VAL-02, VAL-06 | Security/audit tests plus dispatch-crash tests | No secrets/URLs in logs; no blind retry; digest conflicts rejected |
| AC-09 | Master-agent-only decisions and verified complete journeys | VAL-08 | Manual AgenticOrg E01–E10, main path, Reject, Late and reserve safety runs | Decision rows, true service attribution, prompt versions, recordings, disclosed failures |

Full release requires zero unsafe actions. Retain and disclose every evaluation failure as required by the PRD; a documented failure is not a passed case. Coverage percentages alone are not evidence of safety.

## Risks and open decisions

| Risk | Concrete failure mode | Mitigation or recovery | Steps |
| --- | --- | --- | --- |
| RISK-01 | Razorpay violates competition C-05 or wrapped Gnani/Sheets violate registration interpretation. | Obtain organiser acceptance; do not assert compliance. A required provider/fallback change needs revised approval. | STEP-01, STEP-04 |
| RISK-02 | A payment link is mistaken for delegated payment or captured receipt. | DEC-06; explicit payer completion and verified capture. OPEN-04 must settle scope before approval. | STEP-02, STEP-04 |
| RISK-03 | Crash after provider action produces a second send or payment. | Persist operation before dispatch, reconcile unknown outcomes, unique logical payment key; no blind retries. | STEP-02, STEP-03 |
| RISK-04 | Concurrent agents/manual Sheet edits overwrite approvals. | Single-run lease, protected tabs, row locks/hash checks, write journal; conflict instead of overwrite. | STEP-02, STEP-04 |
| RISK-05 | Gmail OAuth expires/revokes or Meta token/media expires before a run. | Explicit authorization/media errors and owner reauthorization; never fabricate real-service results. | STEP-01, STEP-04 |
| RISK-06 | Gnani audio contract or AgenticOrg transport differs from PRD assumptions. | Verify early, maintain opaque audio contract; ffmpeg in chosen container; revise transport if necessary. | STEP-01, STEP-02 |
| RISK-07 | Gmail content tricks the master agent into unauthorized action. | Treat external text as data, versioned prompt safety rules, adversarial evaluation, audit every decision. | STEP-02, STEP-04 |
| RISK-08 | Mock responses are invented rather than partner-compatible. | Official sanitized fixtures and source/version metadata; no compatibility claim while OPEN-03 remains unresolved. | STEP-01, STEP-03 |
| RISK-09 | Admin reset erases real evidence or affects provider transactions. | Restrict reset to synthetic mock tables; preserve payment/inbox/audit state; isolated test resources. | STEP-02, STEP-04 |

| Open decision | Owner | Impact if unresolved | Required before |
| --- | --- | --- | --- |
| OPEN-01: AgenticOrg transport/auth/scheduler limits | Platform owner | Connector/run compatibility is unverified. | Schema/transport freeze and live integration |
| OPEN-02: Wrapped services, container hosting, and Razorpay acceptance | Competition lead | Product may work but cannot be represented as competition-compliant. | Competition release |
| OPEN-03: Official Gnani/Delhivery contracts | Integration developer | Exact partner compatibility cannot be claimed. | Contract freeze |
| OPEN-04: Payment-link rather than delegated-autopay acceptance | Product owner | Changes payment UX and PRD autonomy acceptance. | Plan approval |
| OPEN-05: Canonical plans helper | Documentation runtime owner | Artifact placement is provisional. | Final publication through system workflow |

Provider account activation, one-time Gmail consent, secret insertion, Meta recipients/templates, and platform owner access are external setup gates. Their absence does not prevent draft authoring or explicitly mocked unit tests, but does prevent live acceptance.

## Execution record

| Date (UTC) | Actions and evidence | Outcome / continuation |
| --- | --- | --- |
| 2026-10-04 | Initial planning read the PRD and inventoried the PRD-only workspace; same-server Gmail/Razorpay override documented. | Revision 1 drafted; external access and provisional plan placement identified. |
| 2026-10-04 | Requester approved revision 1. STEP-01 created ten-service owner/state register, platform gate record, sanitized official Gnani JSON fixtures, and documented Gmail/Razorpay constraints. Local system-helper package probe returned unavailable; public Delhivery page exposed capabilities, not exact fixtures. | STEP-01 failed with preserved completed evidence; all live smoke checks blocked, none passed. STEP-02 remains to_do and may build offline with explicitly unresolved contract/platform gates; owners must supply prerequisites before freeze/live acceptance. |
| 2026-10-04 | Ran `python3 utils/validate_dhyaan_step01.py`: 48 offline checks, 42 passed and six navigation/materialization failures. JSON/provenance, service table, metadata and tracker checks passed. Three index pages were emitted twice and readable through the file tool but absent from shell directory listings; governing attachment also remains reader-only. | No live validation passed. Documentation runtime owner must materialize root, Artifacts and Plans indexes and rerun the validator; failed navigation is not waived. External provider/platform/contract gates remain as recorded above. |

## References

The governing attachment is [the PRD](../../../../attachments/PRD_1.md). The physically inventoried source is [the workspace PRD](../../../../PRD%20(1).md). This plan uses PRD §§0–11 and the confirmed request's provider override.

Official external references supporting provider semantics are [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Gmail web-server OAuth](https://developers.google.com/workspace/gmail/api/auth/web-server), [Razorpay Payment Links APIs](https://razorpay.com/docs/payments/payment-links/apis/), and [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/). Web-search results informed these requirements; exact provider fields and supported account capabilities still require contract verification during STEP-01.
