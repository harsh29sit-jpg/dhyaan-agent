# Dhyaan service setup evidence

## Current Render continuation

The requester reports updated required services and requests Render hosting.
Those bindings have not been independently verified in this session. Follow
the [Render deployment and read/write guide](render-deployment.md) for the
root Blueprint, migration gate, protected configuration, transport smoke and
owned refill sequence. Historical missing/deferred rows below describe earlier
offline evidence, not proof that the user's updated accounts are absent.
No Render deploy or completed pharmacy order is established by this preparation.

The requester has now supplied the repository and Render origin and selected
manual fulfillment. Public GitHub reachability was observed, but Render health
and unauthenticated MCP probes timed out; activation remains unverified.
The existing confirmation/get flow now exposes an owned local manual-review
packet, not an operator notification or completed order. See the
[selected manual route and missing process details](render-deployment.md#selected-manual-fulfillment-route).
An authorized operator, secure handoff destination and approved review/payment/
collection/evidence procedure remain unspecified; do not invent these.

## Active replacement scope — PLAN-DHYAAN-MCP-002

Revision 1 was explicitly approved with “Approve plan”; implementation is offline
and configuration remains deferred. The register below is historical evidence
for PLAN-DHYAAN-MCP-001, not a requirement to activate its providers.

STEP-01 verification (2026-10-04, Node 22.20.0): after approved
materialization, `CI=true npm run build`, `CI=true npm run lint`,
`CI=true npm test` and `CI=true npm run test:mcp` exited 0. Full suite:
49 tests in 8 files; SDK target: 4 tests; compiled catalog: 36 names matching
the saved contract. Focused tests use synthetic doubles, not real database
concurrency or provider evidence. STEP-02 independent coverage and STEP-03
consolidated/startup verification are now complete for offline delivery only.

### Final offline acceptance — STEP-03, 2026-10-04 (UTC)

Runtime: Node 22.20.0 / npm 10.9.3. Commands ran from `dhyaan_mcp/` with
`env -i PATH=/private/tmp/node-v22.20.0-darwin-arm64/bin:/usr/bin:/bin CI=true`.
The temporary runtime path is evidence, not an infrastructure requirement.

| Check | Exact command / method | Outcome |
| --- | --- | --- |
| Production compiler | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0; no deprecation warnings observed |
| Full offline suite | `npm test -- --reporter=verbose`, then `npm test` | each 154 passed, 0 failed, 0 skipped in 14 files; 458/456 ms |
| SDK discovery | `npm run test:mcp` | 4 passed, 0 failed/skipped; 260 ms; loopback with synthetic audit |
| Independent test typing | `./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --esModuleInterop --skipLibCheck --resolveJsonModule tests/test_revised_contracts.test.ts tests/test_telegram.test.ts tests/test_voice.test.ts tests/test_maps.test.ts tests/test_location.test.ts tests/test_refill.test.ts` | exit 0 |
| Compiled catalog | `npm run --silent catalog` piped to Node assertions against `contracts/mcp-tools.json` | exit 0; all 36 names in order, unique, object input schemas; no WhatsApp/admin/reset/SQL/decision tools |
| Clean compiled startup | `env -i PATH=/private/tmp/node-v22.20.0-darwin-arm64/bin:/usr/bin:/bin PORT=33103 CI=true /private/tmp/node-v22.20.0-darwin-arm64/bin/node dist/src/server.js` plus loopback assertions | 5 passed in 34 ms; live 200, ready/MCP/Telegram 503, removed WhatsApp 404 |

Total: 317 passing test executions (154 twice, four SDK reruns, five startup
checks), 159 distinct tests/checks; reported test/smoke durations total
1.208 seconds excluding compiler/lint/type-check and process setup.
Readiness explicitly reported `ready:false`, `database:false`, five missing
core names and every service unconfigured, disabled and live-unverified.
No real credentials, provider calls, `.env` access, registrations, polling,
migrations or service activation were performed. Temporary process handles
were stopped. The test transport/SQL/storage doubles prove offline behavior,
not account access, physical deletion or actual database locking/durability.

The approved offline plan is complete. Activation remains **deferred / not
executed**, including real Postgres migrations/concurrency, Docker image
execution, live providers, private object lifecycle/deletion, audio playback,
AgenticOrg and fulfillment. Docker and psql were not on PATH. Keep provider
flags false and readiness unready; the unchecked activation checklist in the
[active plan](../../kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-telegram-maps-implementation-plan.md)
retains concrete owner guidance. Navigation indexes were reader-visible but
absent on disk; targeted writes accompany final status synchronization, and
internal plans-helper reconciliation remains OPEN-04.

New names in `.env.example`: `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_IDS`, `GNANI_ENABLED`,
`GOOGLE_MAPS_ENABLED`, `GOOGLE_MAPS_API_KEY`. Defaults disable new integrations.
Existing private `AUDIO_S3_*` names and trusted `GNANI_BASE_URL` remain required.
No real credentials are stored in source. Rotate the exposed Gnani credential
before activation; never reuse its value from chat.

Owner-run activation is deferred: bind isolated core/Postgres configuration;
apply additive migrations 001–004; bind private storage and provider settings
with flags false; verify bucket privacy, one-hour lifecycle deletion and access
restrictions; review Maps API/key/billing restrictions and attribution; enroll
numeric private Telegram senders; enable verified integrations in an isolated
deployment; explicitly register `/webhooks/telegram` with its distinct secret;
test voice codec/playback and timely location/share/revoke; confirm that a local
request remains pending manual pharmacy handoff. Bind/re-register the revised
36-tool connector and v002 only after AgenticOrg verification.

STT is bounded to 60 seconds and 10 MiB. The implementation accepts bounded
OGG intake and sends synthesized WAV through `sendAudio`; real codec behavior
is not established by synthetic fixtures. Reference expiry denies access
immediately; physical object deletion requires the independently verified
bucket lifecycle. Coordinate cleanup is on authorized lookup, acknowledgement,
revocation and subsequent intake; no perpetual device access or polling exists.
Database, storage, provider, deployment and platform checks are deferred,
not offline pass claims. No payment/shipment/pharmacy dispatch is authorized.

Evidence date: 2026-10-04 (UTC). Scope: STEP-01 / AC-01 / VAL-01 of [PLAN-DHYAAN-MCP-001](../../kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-implementation-plan.md).

## Evidence boundary and states

The work item reports no containers, project definition, or container environment. The local top-level inventory contained the PRD, assets and plan documentation, with no application or `.env`. Knowledge search found scaffold/sample documentation, not service setup evidence. No secret store, provider dashboard or owner session was supplied. This does not prove accounts do not exist elsewhere.

`missing` means required configuration/access is unavailable in this execution context; `configured` requires an owner-confirmed secret-store binding, not a placeholder; `verified` additionally requires a dated successful authentication/action check. All services below are missing locally; none is configured or live-verified. Public documentation checks are not authentication checks.

Owners below are accountable roles from the plan and PRD; they are not claims of accepted assignments. The team lead must bind these roles to actual people. Aditya is the PRD's proposed platform owner, not a verified registrant.

## Configuration and verification register

Configuration names are the approved plan's proposed interface, not discovered environment values. Store values only in approved secret management.

| Service | Responsible owner | Configuration names / access | Local state | VAL-01 outcome and next check |
| --- | --- | --- | --- | --- |
| Application / HTTPS host | Infrastructure owner (PRD P3) | `NODE_ENV`, `PORT`, `PUBLIC_BASE_URL`, `MCP_API_KEY`, `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `UPSTREAM_TIMEOUT_MS` | missing | BLOCKED: no application, deployment or secret bindings. Provision one Node 22 container; confirm TLS, origin allowlist, distinct auth secrets and readiness. |
| Neon Postgres | Infrastructure owner (P3) | `DATABASE_URL` | missing | BLOCKED: no isolated branch/access. Check TLS, bounded pool and migration rights on a test branch; retain sanitized connection outcome only. |
| WhatsApp Cloud API | Channel owner (P1) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | missing | BLOCKED: app, number, enrolled recipients and templates unverified. Pin supported Graph version; verify number access, webhook and one synthetic inbound/reply; obtain system-user token before recording. |
| Gnani | Integration developer (P2/P3) | `GNANI_API_KEY_ID`, `GNANI_BASE_URL` | missing | BLOCKED: key/credits and sample audio unavailable. Public REST examples obtained; test a short synthetic Hindi OGG/Opus clip and play returned TTS audio on the test phone. |
| Google Sheets | State/workbook owner (P1) | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_SPREADSHEET_ID` | missing | BLOCKED: workbook sharing and API enablement unverified. Read headers and append/read a synthetic row in an isolated workbook; protect source tabs; Family View read-only. |
| Gmail | Mailbox/OAuth owner (P2) | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN` | missing | BLOCKED: dedicated mailbox consent absent. Refresh credential, list/read a synthetic message and thread, send once to an approved tester, retain redacted identity/delivery outcome. |
| Razorpay test payments | Payment-account owner (P2) and tester/payer | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYMENTS_MODE` | missing | BLOCKED: no test account bindings/webhook or payer. Verify test identity first; create one standard test link, payer completes it, fetch captured full amount/INR and linkage. Never activate live mode. |
| Private audio storage | Infrastructure owner (P3) | `AUDIO_S3_ENDPOINT`, `AUDIO_S3_BUCKET`, `AUDIO_S3_ACCESS_KEY_ID`, `AUDIO_S3_SECRET_ACCESS_KEY`, `AUDIO_S3_REGION` | missing | BLOCKED: bucket/permissions unavailable. Upload/read/delete synthetic audio with private ACL and limited prefix. Verify one-hour reference expiry and actual deletion separately; lifecycle expiry is not proof of immediate deletion. |
| Delhivery mock | Integration developer (P2) | `DELHIVERY_MOCK_TOKEN`; official contract export access | missing | BLOCKED: mock not implemented; exact official fixtures unavailable. Obtain contract exports, then test token refusal, creation/tracking/NDR and persistent synthetic state. No real shipping credential is required for the mock. |
| AgenticOrg + native scheduler | Platform owner (P2; proposed Aditya, unconfirmed) | Owner session, connector registration, protected MCP bearer binding, scheduler permission | missing | BLOCKED: no owner session or deployed MCP. Follow [platform gates](platform-notes.md); do not treat public docs as tenant verification. |

## Callback and webhook paths

| Surface | Intended path / registration | State |
| --- | --- | --- |
| MCP | Public HTTPS origin plus `/mcp`; bearer secret in protected platform credential field | Proposed, not deployed |
| WhatsApp | Public HTTPS origin plus `/webhooks/whatsapp`; GET challenge token and POST raw-body HMAC | Proposed, not subscribed |
| Razorpay | Public HTTPS origin plus `/webhooks/razorpay`; separate test webhook secret | Proposed, not subscribed |
| Gmail OAuth | Exact `GMAIL_REDIRECT_URI` registered on the owner's OAuth client | Unset. Choose an implemented owner-only local callback for one-time bootstrap; path is not an existing server route. |
| Scenario administration | `/__admin/*`, separate admin credential; not discoverable as MCP tools | Proposed, not deployed |

Do not register placeholder domains. Gmail OAuth bootstrap must validate state and exact redirect match, exchange the code privately, store the refresh token securely, and expose no OAuth tool through MCP. Sheets service-account credentials do not authorize a consumer Gmail mailbox.

## Verified public contract constraints

Documentation was read on 2026-10-04; provider account capabilities remain unverified.

- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes): `gmail.readonly` is restricted; `gmail.send` is sensitive. Do not add modify/delete/full-mail scopes. The mailbox owner must review applicable verification and server-side restricted-data security assessment requirements/exemptions before broader publication.
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server): request offline access and check actual granted scopes; redirect scheme/case/trailing slash must match. Revocation/expiry requires owner reauthorization, not silent fabricated success.
- [Razorpay standard links](https://razorpay.com/docs/api/payments/payment-links/create-standard/): API amount is integer subunits; whole INR converts exactly to paise. Use `currency=INR`, `accept_partial=false`, `notify.sms=false`, `notify.email=false`, `reminder_enable=false`, and standard links (`upi_link=false` or omitted). Dedicated UPI links are documented as unsupported in test mode; do not switch to live keys to bypass this.
- The page redirected to a US-localized official variant during retrieval; INR-specific fields/errors were present. Confirm Indian merchant account behavior with test keys before freezing account-specific capabilities.
- Payment Link `reference_id` must be unique and at most 40 characters. Use an opaque bounded reference mapped durably to journey/task; no medicine/patient data. Same-reference rejection is not an exactly-once guarantee.
- The documented test quota is 30 links per business. Reuse reconciliation evidence; budget evaluation links, and contact provider support for more if needed. Do not assume local resets restore provider quota.
- Payers complete hosted Checkout; `created`, `authorized`, `partially_paid`, missing capture or mismatch never counts as paid. The documented link `payments` array contains captured payments; verify a payment fetch plus exact amount/currency/link-to-task mapping. Approval to implement the plan is not a completed payer payment.
- [Gnani fixtures and constraints](../contracts/provider-fixtures/README.md) distinguish documented examples from live evidence.

## VAL-01 record

| Check | Date | Outcome | Evidence / reason |
| --- | --- | --- | --- |
| Supplied plan and PRD reviewed | 2026-10-04 | PASS, document inspection only | Stable STEP-01 contract, ten service categories, one MCP + master-agent-only decisions |
| Bounded workspace inventory | 2026-10-04 | PASS, local inventory only | PRD/plan workspace; no application/env in supplied inventory |
| Service owner/state/outcome record | 2026-10-04 | PASS | Ten names-only rows above; actual people/account access unconfirmed |
| Gnani public request/response examples | 2026-10-04 | PASS, documentation only | Sanitized JSON fixtures with sources, no credentials or binary content |
| Delhivery exact partner fixtures | 2026-10-04 | BLOCKED | Public B2C page lists API capabilities only; help page directs clients to logged-in docs/test console |
| Platform and competition gates | 2026-10-04 | BLOCKED | Owner and organiser evidence absent; [continuation register](platform-notes.md) |
| Per-service authentication/action checks | 2026-10-04 | BLOCKED, not executed | Configuration, accounts, deployed app and payer unavailable |
| Canonical plans helper | 2026-10-04 | BLOCKED | `importlib.util.find_spec('code_generation_core_agent')` returned unavailable; retain requested plan path |
| Offline artifact consistency | 2026-10-04 | PARTIAL: 42/48 checks passed | `python3 utils/validate_dhyaan_step01.py` validated JSON/provenance, state table and plan metadata/tracker. Six failures concern three navigation indexes absent from shell despite file-reader visibility and repeated write operations; documentation runtime owner must materialize them and rerun. Attachment PRD remains reader-only (warning). |

## Safe continuation and recovery

The requester approved implementation of revision 1, not a claim of account readiness or competition compliance. STEP-02 may implement offline mechanics and fail-closed `NOT_CONFIGURED` adapters using explicit test doubles. Do not freeze unverified Delhivery response contracts or claim live/platform acceptance until the owners supply evidence.

For each owner-run check append date, accountable role, secret-free request purpose, status/result code, sanitized evidence location and exact next action. Never capture tokens, authorization headers, OAuth codes, connection strings, real phone numbers, private messages or raw dashboard screenshots. No authorizations, sends, payments or resource resets were performed in STEP-01. If later consent is accidental, revoke it; if any credential leaks, rotate it and disable dependent schedules.
