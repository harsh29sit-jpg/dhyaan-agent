# Provider fixture evidence

[Service setup](../../docs/service-setup.md) · [Platform gates](../../docs/platform-notes.md).

Retrieved: 2026-10-04 (UTC). These are public documentation examples, not responses from authenticated service calls. No credentials, user audio or binary payloads are stored.

## Gnani

| Fixture | Official source | Version / evidence |
| --- | --- | --- |
| [STT contract](gnani-stt.json) | https://docs.gnani.ai/api/STT/speech-to-text | `/stt/v3`; page identifies Prisma v2.5; publication revision not exposed |
| [TTS contract](gnani-tts.json) | https://docs.gnani.ai/api/TTS/tts-inference | `/api/v1/tts/inference`; documented recommended model `timbre-v2.5`; publication revision not exposed |

STT requires multipart `audio_file` and `language_code`, with `X-API-Key-ID`. Maximum clip duration is 60 seconds (ideal 30); OGG is documented, but actual WhatsApp Opus compatibility is not live-tested. Do not fabricate `confidence` or provider `duration_s`: neither appears in the documented success example. Local measured audio duration can be explicitly identified as local metadata.

TTS uses `language`, not `language_code`, in the provider request; the MCP may retain its own approved `language_code` input and map it mechanically. The prose calls `voice` and `language` required while the schema/example is less restrictive. Send explicit reviewed voice/language/model and validate with the actual account before freezing account-specific behavior. A successful response is raw binary audio, not JSON/base64. `container=ogg` produces OGG Opus; `mp3` is also documented. Stored JSON describes the binary response; it does not contain audio bytes.

Use direct bounded HTTP without hidden business retries; do not copy SDK automatic-retry behavior into the server. Keep transcript substitutions/boosting disabled by default to avoid inventing medicine terms.

## Delhivery — exact fixtures blocked

Official sources read:
- https://help.delhivery.com/docs/client-developer-portal-1 — updated 2023-08-21; directs clients to logged-in documents and staging test console.
- https://one.delhivery.com/developer-portal/documents/b2c/ — retrieved public page lists capabilities, but exposes no exact payload examples in returned content.

No exact Delhivery response fixture was obtained. Do not save PRD VERIFY examples as “official” or declare compatibility. No login/network restrictions were bypassed.

Integration developer must obtain sanitized exports for:

| Planned PRD route (not independently frozen) | Required success/failure evidence |
| --- | --- |
| `GET /c/api/pin-codes/json/` | Serviceable, empty NSZ, Embargo, query and auth validation |
| `POST /api/cmu/create.json` | Form encoding, shipment and pickup fields, duplicate order, invalid input/warehouse, documented capacity failure if available |
| `GET /api/v1/packages/json/` | In Transit, Delivered, NDR scan/code, unknown waybill/reference |
| `GET /api/kinko/v1/invoice/charges/.json` | Quote units/fields, invalid pincode, absent quote |
| `POST /api/p/update` | Allowed NSL actions/attempt rules and asynchronous result identifier |
| `GET /api/cmu/get_bulk_upl/{UPL_ID}` | Completed/pending/unknown UPL and verbose behavior |

Each export must record source URL, API/version/date, HTTP method/path/status, exact sanitized request encoding and response shape, replaced sensitive fields, and documented versus staging-observed provenance. Preserve field names/casing/nesting and error wording; redact credentials, customer names, addresses and phone numbers. Simulated timeouts/malformed/no-rider scenarios must be labeled synthetic if not provider-documented.

PRD response examples and the proposed max-two-attempt rule remain provisional until reconciled with these exports. This gate blocks exact partner contract freeze, not explicitly labeled offline test doubles.
