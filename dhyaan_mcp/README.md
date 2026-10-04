# Dhyaan MCP — offline bootstrap

One Node.js 22 ESM service. The AgenticOrg master agent remains the only
decision-maker. Active scope is approved PLAN-DHYAAN-MCP-002 revision 1:
Telegram, Gnani voice, consent-bound Maps pharmacy candidates and confirmed
local refill requests. This is offline mechanics, not a deployed or
provider-verified medicine fulfillment service.

## Render hosting

The root `render.yaml` and [Render deployment guide](docs/render-deployment.md)
prepare Docker hosting, pre-deploy migrations, transport health and a bounded
SDK lease read/write smoke check. Updated service configuration is
user-reported, not yet live-verified here. A confirmed refill still ends at
`PENDING_HANDOFF`, not a completed pharmacy order. Hosting readiness at
`/health/transport` is separate from gated whole-application `/health/ready`.

## Revised Telegram / Maps scope

### STEP-01 verification — 2026-10-04

Node 22.20.0: `CI=true npm run build`, `CI=true npm run lint`,
`CI=true npm test` and `CI=true npm run test:mcp` all exited 0 after
materialization. The full suite passed **49 tests in 8 files**, including
14 focused revised-mechanics checks; the separate SDK target passed 4 tests.
Compiled registry names matched all **36** saved catalog names in order.
An initial Buffer type-inference error and synthetic event chronology
failure were corrected before the final run. Tests use explicit synthetic
transport/persistence doubles, not real Postgres or provider acceptance.
Independent STEP-02 coverage and STEP-03 startup verification are now complete;
their final evidence is recorded below.

- 36 provisional tools derived from schemas; no active `wa_*` tools and no
  `/webhooks/whatsapp` route. Historical WhatsApp components/data are retained.
- Telegram webhook: `/webhooks/telegram`, authenticated with a distinct bounded
  secret header before JSON parsing. Registered numeric senders, private chats
  only; normalized updates commit before HTTP 200. No polling or registration
  occurs on startup.
- Telegram, Gnani and Maps require complete configuration **and** explicit
  enable flags (default false). Otherwise audited tools return `NOT_CONFIGURED`
  and make zero provider calls. Readiness stays 503; configured, enabled,
  implemented and live_verified are independent redacted states.
- Every revised operation uses an active run/lease and claimed source update;
  outbound sends/speech retain durable reservations and uncertainty. Local
  success and replay evidence commit together.
- Gnani uses bounded OGG STT (60 seconds / 10 MiB) and binary WAV synthesis;
  private one-hour references never expose storage/download URLs. WAV sends
  use Telegram `sendAudio`, not a falsely labeled Opus voice note.
- Location requests are one-time, purpose-bound, same-sender private shares.
  Ten-minute expiry and `/cancel_location` are enforced. Coordinates are purged
  after authorized lookup/acknowledgement and expired rows on subsequent intake.
  Reference expiry is enforced even before physical deletion.
- Maps uses fixed pharmacy-only Nearby Search with distance ranking and
  attribution; candidates do not establish stock, route time or fulfillment.
- Local preparation needs explicit medicine/strength/quantity, a current
  lookup candidate and prescription reference (not independently verified
  clinical evidence). Confirmation needs a new identity/token-bound event.
  Result is `PENDING_HANDOFF`, always `fulfillment_verified:false`.
- `v002.txt` documents this workflow; platform binding remains deferred.

### STEP-03 final offline verification — 2026-10-04 (UTC)

Node **22.20.0**, npm **10.9.3**, non-interactive CI, inherited environment
removed. `npm run build`, `npm run lint`, `npm test -- --reporter=verbose`,
`npm run test:mcp` and the explicit strict NodeNext type-check of all six
independent `test_*.test.ts` suites passed. Compact `npm test` confirmation
also passed. Each full run: **154 passed / 0 failed / 0 skipped in 14 files**
(458 ms and 456 ms); separate SDK target: **4 passed** (260 ms).
STEP-02 contributed 105 independent tests. `npm run --silent catalog` matched
all **36** saved contract names in order, with unique names, object schemas
and no WhatsApp/admin/reset/SQL/decision tools.

Clean compiled startup used:

```sh
env -i PATH=/private/tmp/node-v22.20.0-darwin-arm64/bin:/usr/bin:/bin PORT=33103 CI=true /private/tmp/node-v22.20.0-darwin-arm64/bin/node dist/src/server.js
```

This temporary Node path is local verification evidence, not a deployment
requirement. Five loopback assertions passed in 34 ms: `/health/live` 200,
`/health/ready` 503, unauthenticated/unconfigured `/mcp` POST 503,
`/webhooks/telegram` POST 503 and removed `/webhooks/whatsapp` POST 404.
Readiness reported `ready:false`, `database:false`, all five missing core
settings and every service unconfigured, disabled and `live_verified:false`.
Temporary server/test process handles were stopped.

Total: **317 test executions**, all passed (154 twice + four SDK reruns +
five smoke checks); **159 distinct tests/checks**. Reported test/smoke runtime
totaled 1.208 seconds, excluding build/lint/type-check/process setup.
No failures or deprecation warnings were observed; no production code,
`.env`, credentials, webhook registration, polling or service activation changed.
Provider responses and SQL routing remain synthetic; loopback SDK/HTTP
acceptance is not live provider or real Postgres verification.

PLAN-DHYAAN-MCP-002 is complete **for offline delivery only**. Real migrations,
Postgres concurrency/crash durability, Docker image execution, private storage
lifecycle/deletion, Telegram/Gnani codec playback, provider quotas/restrictions,
AgenticOrg binding and actual pharmacy fulfillment remain **deferred / not
executed**, not passes. Docker and psql were absent from PATH. Follow the
owner-run activation gates in [service setup](docs/service-setup.md), leaving
service flags false until separately verified; local requests remain
`PENDING_HANDOFF` with `fulfillment_verified:false`.

The [active plan](../kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-telegram-maps-implementation-plan.md)
records completed independent test/verification steps and unchecked activation
gates. No `.env` was read or written.
Migrations 001–003 remain unchanged; 004 is additive. Real database
concurrency, private storage lifecycle/deletion, codec playback, provider
accounts, Docker and AgenticOrg remain separately unverified.

## Local checks

Install Node 22, then from this directory run:

```sh
npm install --ignore-scripts
npm run build
npm run lint
npm test
npm run test:mcp
npm run catalog
npm start
```

`npm run catalog` prints the machine-readable **provisional** allowlist and
JSON schemas directly from the registry. OPEN-01 platform evidence and
OPEN-03 official partner exports must arrive before registration/contract
freeze. Schema changes require re-registration.

Configuration names are in `.env.example`; request protected values from
the owners through the orchestrator. Do not edit or commit `.env`.
Missing core credentials do not enable unauthenticated MCP. `PUBLIC_BASE_URL`
is an exact origin, not a path; `ALLOWED_ORIGINS` is comma-separated exact
origins. Production origins require HTTPS. MCP bearer/admin secrets must be
distinct and at least 32 characters. Database connections require
`sslmode=verify-full`; do not weaken certificate verification. Only Razorpay
test keys with `PAYMENTS_MODE=test` are accepted.

## Historical bootstrap behavior (superseded by revised scope above)

- Public `/health/live`; redacted `/health/ready` deliberately returns 503
  with `bootstrap_only` until the remaining capabilities are implemented.
- Authenticated, bounded, stateless SDK Streamable HTTP POST at `/mcp`.
  Both Host and any supplied Origin are validated. One shared 100/minute
  limiter is local to this single process, not a platform-limit measurement.
- 32 provisional tools; no admin, OAuth, reset, SQL or decision tools.
- Durable Postgres audit precondition and run lease acquire/renew/release.
- Provider tools return `NOT_CONFIGURED`, `NOT_IMPLEMENTED`, or
  `CONTRACT_UNVERIFIED`. They never simulate real service success.
- Signed raw-body WhatsApp intake, receiver validation and persistent
  deduplication. Claims/acknowledgements require active matching run leases.
  Missing intake configuration/database returns 503, never a false acknowledgement.
- Strict PRD-derived state columns/types and 28 rule IDs are validated before
  dispatch. Sheets writes and recovery journal are not implemented yet.
- Razorpay raw-body signed minimal event intake, durable ID/digest deduplication,
  test-only status reads and server-mapped capture reconciliation are integrated.
  Missing configuration/persistence returns failure; create/cancel remain disabled.
- Persistent operation reservation primitive prevents blind redispatch
  after ambiguous actions. It is not yet connected to provider handlers.

## Database

The owner must supply an isolated Neon branch through `DATABASE_URL`.
`npm run build` followed by `npm run migrate` applies additive migrations
under a transaction/advisory lock. Migration files remain outside `dist/`
and must be shipped alongside the built service. No migration runs at
application startup, no destructive reset is provided, and no implicit
in-memory persistence substitutes for Postgres.

## Safety and continuation

Only synthetic demo data is allowed. Argument content, provider bodies,
tokens, connection strings and media URLs must not enter host audit logs.
Audit uses keyed fingerprints; durable STARTED rows survive incomplete
dispatches. Failed audit completion returns uncertainty, not a safe-retry
signal. Conservative RESERVED/DISPATCHED operations need reconciliation
after crashes; exactly-once external delivery is not claimed.

Historical backlog, not authorized by the active replacement plan: remaining persistence tables, Sheets journal/versions,
WhatsApp sends/Gnani/audio, Gmail, Razorpay, provisional
Delhivery/X-1, deployment assets and the single-agent prompt. Live service
checks, official Delhivery response freeze, AgenticOrg compatibility and
organiser acceptance remain gated as recorded in
[the saved plan](../kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-implementation-plan.md).
Razorpay uses payer-completed test links, not delegated autopay.

## Offline verification — 2026-10-04

Node 22.20.0: TypeScript build and lint passed; all 35 focused tests passed.
The separate SDK target passed four checks; compiled catalog matched the
32 saved names. A clean compiled startup returned liveness 200 and
readiness/MCP 503 with missing core configuration, as intended.
Tests use explicit synthetic doubles, not live providers or real Postgres.
Docker and psql were unavailable on PATH; migrations, database concurrency,
image execution and live services remain unverified. The draft master-agent
prompt is not bound or evaluated on AgenticOrg.
