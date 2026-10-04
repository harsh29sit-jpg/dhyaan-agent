# Dhyaan platform and external gate register

Evidence date: 2026-10-04 (UTC). [Saved plan](../../kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-implementation-plan.md) · [Service setup](service-setup.md).

## Platform evidence

Target: AgenticOrg, organisation “Ken's case competition” per PRD. Register one `dhyaan_mcp` connector containing Gmail and Razorpay along with the other approved tools; retain only native Agent Scheduler for timing. Every decision remains in the single master agent.

Accountable owner: platform owner (P2). PRD proposes Aditya; actual owner, login, company/tenant context, connector identity, model/model revision, temperature, token budget and prompt binding are unverified. No account session was supplied.

[Public connector guidance](https://agenticorg.ai/docs/connectors) (reviewed 2026-10-02, read 2026-10-04) describes protected credentials, company/tenant binding, Authorized Tools and permission checks. It explicitly warns that a green health badge does not prove business-action readiness. Its deployed features may differ by environment.

[Public API/SDK/MCP guide](https://agenticorg.ai/docs/api-sdk-mcp) describes AgenticOrg's own stdio adapter. That is not proof that this tenant can consume our remote stateless Streamable HTTP server. Do not replace the approved inbound connector design with that adapter or invent a platform invocation endpoint.

## OPEN-01 acceptance measurements

All rows remain BLOCKED pending owner access and a deployed synthetic MCP. PRD values are assumptions, not measurements.

| Gate | Approved assumption | Owner action and acceptance evidence |
| --- | --- | --- |
| Inbound MCP transport | Stateless Streamable HTTP at `/mcp` | Register deployed test endpoint; record initialize protocol negotiation and tools/list/call outcomes. If only SSE is supported, record rejection and revise approved transport before registration freeze. |
| Bearer registration | `Authorization: Bearer` via protected field | Confirm exact form/header behavior. Valid credential must work; missing/wrong credential must be refused. Do not put bearer values in screenshots. |
| Ownership and visibility | Same registrant owns connector and agent; private visibility per PRD | Verify under actual tenant and owner; record account alias without private identifiers, visibility and agent binding. Public company-binding guidance does not establish private-registration semantics. |
| Tool scope | Frozen allowlist, no admin/decision/OAuth tools | Grant only required tools; verify permitted read, ungranted call and cross-company denial where applicable; compare discovered names/schemas to catalog. |
| Model and limits | Platform-provided model; unset settings | Record selected model/revision, temperature, input/output limits and tool-call budget from actual UI; no fabricated defaults. |
| Connector rate limit | PRD proposes shared 100 calls/min | Measure configured limit, scope of sharing and 429 behavior using bounded synthetic reads. Record burst and sustained constraints. |
| Timeout and retries | Unknown | Bounded read-only delay/error probe; record deadline, retry count and duplicate request identities. No payment/send probes until duplicate-safety tests pass. |
| Scheduler cadence | Target one-minute demo polling | Owner verifies supported minimum, timing/timezone and overlap/manual-run behavior. Three-minute reminder/six-minute timeout are proposed policy settings, not guaranteed scheduler timing. |
| Run-history export | Unknown | Export one synthetic run or record supported alternative; preserve prompt version and redacted trace. |
| Hosting | One always-on public HTTPS container | Infrastructure owner selects host and stable origin, verifies TLS and origin policy. No host selected or provisioned here. |

## External gate disposition and continuation

| ID | Current outcome | Accountable owner | Precise action / evidence required to resume |
| --- | --- | --- | --- |
| OPEN-01 | BLOCKED | Platform owner (P2) | Obtain owner session, deploy bounded test server, execute table above; attach sanitized outcomes before transport/schema freeze and live integration. |
| OPEN-02 | BLOCKED | Competition team lead | Obtain written organiser acceptance of MCP-wrapped WhatsApp/Gnani/Sheets, same-server Gmail, Razorpay instead of Pine Labs, and always-on hosting instead of mandated/suggested Vercel. User approval is not organiser approval. Keep response outside secrets; record dated decision. If rejected, revise scope/fallback and get approval, never claim equivalent compliance. |
| OPEN-03 | PARTIAL / BLOCKED | Integration developer (P2/P3) | Gnani official REST examples are captured. Supply missing companion API specs and logged-in Delhivery documentation/test-console exports for all six planned routes, including successes and failures, source/version/date. Complete actual OGG/Opus STT and TTS playback checks. |
| OPEN-04 | Provider semantics VERIFIED; implementation scope approved by requester | Product owner and test payer | Approved revision 1 explicitly uses payer-completed standard test links, not delegated autopay. Record this limitation in demo instructions; assign tester and prove one captured test transaction before VAL-06/production-style demo acceptance. Do not infer organiser acceptance or preauthorised autonomous charging. |
| OPEN-05 | BLOCKED, non-runtime publication gate | Documentation runtime owner | Supply system-owned plan path helper/API and resolve canonical case-sensitive path/index; migrate only if necessary, preserving PLAN-DHYAAN-MCP-001 and links. Local package probe returned unavailable. Do not install a guessed public package or rewrite the authored plan as a Spec Builder blueprint. |

## Instructions for future agent

The concrete blockers are absent provider/platform authorizations, exact Delhivery fixtures and the unavailable internal path helper. The responsible owners above must supply access through protected channels, not chat or committed files. No current live validation is passed.

Safe STEP-02 continuation is explicitly offline: preserve one application and all safety boundaries, consume the documented Gnani fixtures, build/test configured and unconfigured branches, and label PRD-derived Delhivery test doubles as provisional. Provider compatibility tests and `contracts/openapi/delhivery.yaml` freeze wait for official exports. Live integration and competition release wait for OPEN-01/OPEN-02 and provider smoke evidence. OPEN-05 does not block offline application development; preserve the explicitly requested plan location until the system owner resolves it.

The infrastructure owner must implement enforceable audio reference expiry and deletion. Do not assume a bucket's day-granularity lifecycle meets one-hour deletion. The Gmail owner must complete offline OAuth consent with exact implemented redirect and check granted scopes before synthetic read/send tests. The payment owner must insert only test secrets, select standard links, budget the documented 30-link test quota, and arrange payer completion; never use live credentials to work around test-mode limitations.

Do not add a second agent, provider mock masquerading as live Gmail/Razorpay, automatic business retries, new provider or extra user frontend. Keep unresolved contract gates visible when STEP-02/STEP-03 report their outcomes.
