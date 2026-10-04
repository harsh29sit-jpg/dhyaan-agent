# Render hosting and refill read/write flow

## Status and evidence boundary

The user supplied repository `https://github.com/harsh29sit-jpg/dhyaan-agent`
and service origin `https://dhyaan-agent.onrender.com`, and selected manual
fulfillment. This session does not have verified access to protected bindings
or a Render owner session.
No `.env` is read or written. This repository prepares hosting; it does not
establish live deployment, provider authentication, or order fulfillment.

### Public continuation checks

The supplied GitHub page returned HTTP 200; this proves public reachability,
not push permission, deployed revision or repository/workspace parity.
Render `/health/live`, `/health/transport`, and an unauthenticated POST to
`/mcp` each timed out after 20 seconds with no response bytes (HTTP `000`).
An initial `/health` probe also timed out; `/health` is not an application
health route. These results do not distinguish a sleeping/unavailable service
from a network-path problem and do not establish auth refusal or readiness.
No Render build logs, deploy ID, migrations, authenticated SDK discovery or
lease write were verified. Names-only checks found no inherited
`RENDER_API_KEY`, `PUBLIC_BASE_URL`, `MCP_API_KEY` or `DATABASE_URL`; protected
configuration elsewhere is unknown. The workspace is still not a Git checkout.
The infrastructure owner must inspect the service/deploy logs, confirm this
origin and revision, publish approved changes, and run the bounded smoke with
protected bindings. Do not weaken authentication or readiness to bypass this.

The root [Render Blueprint](../../render.yaml) uses the existing
[Dockerfile](../Dockerfile). It does not provision a replacement database or
change existing service credentials. Review the paid compute plan before
creating resources. The Blueprint disables automatic deploys and defaults to
one instance because rate limiting is process-local.

### Local verification of this preparation

After approved materialization, Node 22.20.0 checks ran with an isolated,
clean inherited environment (`env -i`, `CI=true`):

- `npm run build` and `npm run lint`: passed.
- `npm test -- tests/render.test.ts tests/mcp.test.ts tests/revised.test.ts tests/test_refill.test.ts`:
  47 passed in four files, including six new Render boundary tests.
- Independent strict NodeNext type-check of `tests/render.test.ts`: passed.
- Compiled smoke CLI with no configuration: expected exit 1 with a sanitized
  failure message before network calls; this is fail-closed behavior, not a
  successful deployed smoke test.

The names-only access probe found none of the required core/provider values
or `RENDER_API_KEY` in this session's inherited environment. `.env` was not
inspected; this does not disprove updated configuration elsewhere.
The workspace is not a Git checkout, and Render CLI, Docker and psql were
not available on PATH. Render account-side Blueprint validation, Docker build,
real migrations, deployed smoke and all live provider/order checks were not
executed. The infrastructure owner must connect the source repository and
provide authorized Render access plus protected bindings to resume deployment.

## Deployment

1. Publish the approved files, including `dhyaan_mcp/package-lock.json`, to
   the owner's private Git repository. Connect that repository in Render.
   Create a Blueprint using root `render.yaml`, or apply these settings to
   the existing web service after reviewing its diff.
2. Confirm Docker context `dhyaan_mcp`, Dockerfile
   `dhyaan_mcp/Dockerfile`, and pre-deploy command
   `node dist/src/db/migrate.js`. The existing image ships migrations 001–004.
   Use an isolated database for initial acceptance. The pre-deploy command
   applies additive migrations transactionally under an advisory lock and
   blocks deployment on failure; it is not a destructive reset.
3. Request protected values from service owners and bind them in Render:
   `DATABASE_URL` (Postgres with `sslmode=verify-full`), `MCP_API_KEY`,
   distinct `ADMIN_TOKEN`, `PUBLIC_BASE_URL`, and `ALLOWED_ORIGINS`.
   Set the exact assigned HTTPS origin as `PUBLIC_BASE_URL` (no path or
   trailing slash). Set allowed client origins explicitly, comma-separated.
   Do not paste credentials into chat or source files. Render supplies `PORT`;
   the server already listens on that port without requiring a proxy-trust bypass.
4. Bind existing Telegram and Maps credentials and sender allowlist privately.
   Set `TELEGRAM_ENABLED` and `GOOGLE_MAPS_ENABLED` explicitly to `false`
   until their owner-run acceptance checks pass, then enable them for the
   isolated test deployment. `sync: false` prompts only on initial Blueprint
   creation; add/update these values manually for an existing service.
   Do not replace a working credential with a placeholder.
5. Voice is optional for the text/location refill flow. For voice, additionally
   bind `GNANI_API_KEY_ID`, `GNANI_BASE_URL`, `GNANI_ENABLED`, and all
   `AUDIO_S3_*` values from [.env.example](../.env.example). Rotate any
   previously exposed credential before use. Verify private bucket access and
   one-hour physical deletion independently before enabling voice.
6. Deploy manually and inspect sanitized build/migration outcome codes.
   Render's health check is `/health/transport`: it requires complete core
   configuration, applied migrations, readable required relations, audit
   availability, and wired durable mechanics. It does not call providers or
   prove write permissions/concurrency. `/health/live` is process liveness;
   `/health/ready` remains 503 because whole-application acceptance is not
   established. Never point the deployment check at that deliberately gated
   endpoint or equate transport health with pharmacy fulfillment.
7. With protected `PUBLIC_BASE_URL` and `MCP_API_KEY` in the caller's inherited
   environment, run from `dhyaan_mcp/`:

   ```sh
   CI=true npm run build
   node dist/scripts/render-smoke.js
   ```

   This bounded check verifies HTTPS liveness, transport readiness,
   unauthenticated MCP refusal, SDK initialize/list discovery, and a synthetic
   30-second run lease acquire/release. It makes no provider, confirmation,
   payment or shipping calls. Failures print no raw SDK errors. An uncertain
   lease write must not be blindly retried; allow the short lease to expire.
8. Register the actual HTTPS `/webhooks/telegram` URL explicitly using the
   owner's protected Telegram setup with `TELEGRAM_WEBHOOK_SECRET` as
   `secret_token`. No webhook registration or polling occurs on startup.
   Check Telegram webhook status without saving secret-bearing request URLs,
   then send one synthetic private message from an enrolled numeric user.
   Verify durable intake and an authorized claim before enabling schedules.
9. Bind the platform connector to HTTPS `/mcp`, bearer authentication and
   stateless Streamable HTTP POST. Re-discover the 36 provisional tool schemas.
   GET/DELETE are deliberately unsupported. Host must match `PUBLIC_BASE_URL`;
   any supplied Origin must be allowlisted. Do not loosen these checks to
   work around a misconfigured client. Bind the reviewed v002 agent prompt
   only after tenant-level compatibility is verified.

See [service setup](service-setup.md) for provider gates. Render fields are
based on the [official Blueprint reference](https://render.com/docs/blueprint-spec);
account-side Blueprint validation and actual Docker execution remain separate checks.

## Required tool sequence

Catalog annotations describe effects, not authorization. All calls still
require bearer auth, durable audit, strict schemas, sender ownership and leases.
Use the discovered schemas rather than inventing fields or copying another
sender's references.

| Stage | Tools and evidence | Effect / completion boundary |
| --- | --- | --- |
| Lease | `run_acquire`, renew the returned lease before expiry | Durable local write, not order authority |
| Intake | `tg_get_new_messages` with that run/lease | Claims private events; this mutates claim state |
| Optional voice | `voice_transcribe`, clarify medicine/strength/quantity | Private media/provider operation, not verified clinical advice |
| Consent | `tg_request_location` on the claimed text event | Sends one-time pharmacy-purpose share request |
| Discovery | Claim the new location event; `pharmacy_nearby_lookup` using its `location_ref` | Consumes coordinates and writes lookup evidence; not read-only and not stock verification |
| Prepare write | `refill_request_prepare` using that location event, current `lookup_ref`, candidate `place_id`, explicit medicine/strength/quantity and prescription reference | `AWAITING_CONFIRMATION` with a ten-minute token, or `pending_clarification`; no purchase |
| Confirmation prompt | `tg_send_buttons` with returned token, or ask for exact `/confirm TOKEN` | Outbound message, not confirmation evidence |
| Confirmation write | Claim a **new** same-sender callback/text event; `refill_request_confirm` with its `source_update_id`, request ID and token | `PENDING_HANDOFF`; `fulfillment_verified:false` |
| Request read | `refill_request_get` with a current claimed event, run/lease and owned request ID | Read-only local status; no provider or stock verification |
| Cleanup | `tg_ack_messages` only after work commits, then `run_release` | Local writes; do not acknowledge the location before selection/preparation |

Use one stable idempotency key for each logical mutation, retaining it across
safe retries. A changed payload with the same key conflicts. `OUTCOME_UNKNOWN`
requires reconciliation rather than another send or a new key. Acknowledge
confirmation only after it commits; callback feedback failure does not undo it.

## Selected manual fulfillment route

No new operator endpoint, role, external notification or completion mutation
is added. Existing authenticated, audited, leased, same-sender confirmation
records `PENDING_HANDOFF` atomically with idempotency evidence. Its result
includes `manual_handoff`: method `MANUAL`, status `AWAITING_OPERATOR_REVIEW`,
an opaque request reference, selected place/medicine/strength/quantity and
prescription/approval references, plus required review checks. References are
not clinically verified. The packet excludes sender/chat IDs and confirmation
tokens. `operator_assigned`, `dispatch_verified`, `evidence_verified` and
`fulfillment_verified` remain false.

`refill_request_get` reconstructs this packet only for an owned
`PENDING_HANDOFF` request under a current claimed event and lease. It does
not offer handoff for awaiting, expired or cancelled requests. This read also
allows pending requests created before this change to use the manual route.
Existing operation-key replays preserve their originally stored response;
use the owned read to recover a packet absent from an older confirmation
response. No second confirmation or new key is needed for packet recovery.

The proposed human checklist is not an approved operating procedure:

1. The owner identifies an authorized operator and an approved secure handoff
   channel/access policy. The MCP bearer is not a verified operator identity.
2. That operator reviews current prescription/clinical and financial approvals;
   unclear/expired evidence requires clarification, not substitution.
3. The operator contacts the pharmacy independently for stock, prescription
   acceptance, exact medicine/strength/quantity, price and order terms.
4. Obtain explicit price/payment and collection/delivery agreement through the
   approved process; do not assume confirmation authorized payment or shipping.
5. Retain independent pharmacy/order identifiers and evidence in an approved
   secure record, with reconciliation and failure/cancellation handling.

Still missing: named authorized operator, secure queue/contact destination,
assignment/escalation and response-time rules, prescription review authority,
payment/collection procedure, evidence location and reconciliation policy.
Do not send the packet or prescription details to a guessed destination.
The service records no completed manual order and accepts no caller-supplied
fulfilled flag; external manual evidence remains independently unverified.

## Order completion blocker

No stock/reservation/purchase/fulfillment integration exists in this scope.
`pharmacy_stock_lookup` remains contract-gated, and configured Sheets/Gmail/
payment/shipping credentials do not implement those missing capabilities.
Nearby pharmacy candidates, prescription references, confirmation tokens,
transport health and Telegram callback acknowledgement are not evidence of
pharmacy acceptance, captured payment, shipment or delivery.

The pharmacy/integration owner must provide an authorized fulfillment API and
its contract (or independently verified manual pharmacy evidence), stock and
prescription review procedure, order identifiers and reconciliation behavior
before a completed medicine restock order can be implemented or claimed.
Do not add a caller-controlled “fulfilled” flag or simulate an order success.

## Acceptance record

Record a revision/deploy ID, date, owner, and secret-free result for each:
Render build, additive migration, transport smoke, sender webhook intake,
consent-bound Maps lookup, prepare/confirm/get persistence across restart,
real database concurrent leases/idempotency, optional voice/storage lifecycle,
and platform binding. Keep deployment/provider/order outcomes separate.
Until those checks execute, their status is unverified, not passed.
