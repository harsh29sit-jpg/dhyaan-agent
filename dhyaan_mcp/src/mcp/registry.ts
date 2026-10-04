import { randomUUID } from 'node:crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Config, ServiceName } from '../config.js';
import type { AuditSink } from '../lib/audit.js';
import { auditDigest } from '../lib/digest.js';
import { failure, ToolError } from '../lib/errors.js';
import type { RunStore } from '../tools/run.js';
import type { WhatsAppInbox } from '../tools/whatsapp.js';
import { schemas, type ToolName } from './schemas.js';
import { validateStateArguments } from './state-schemas.js';
import type { PaymentReads } from '../adapters/razorpay.js';
import type { PaymentEvents } from '../routes/razorpay-webhook.js';
import type { RevisedMechanics } from '../tools/revised.js';

export interface Dependencies {
  audit?: AuditSink; runs?: RunStore; whatsappInbox?: WhatsAppInbox;
  paymentReads?: PaymentReads; paymentEvents?: PaymentEvents;
  revised?: RevisedMechanics;
  telegramInbox?: import('../tools/telegram.js').TelegramInbox;
  /** Check deployment schema only; never implies provider or fulfillment acceptance. */
  deploymentHealthy?: () => Promise<boolean>;
}

function service(name: ToolName): ServiceName | 'postgres' {
  if (name.startsWith('tg_')) return 'telegram';
  if (name === 'pharmacy_nearby_lookup') return 'maps';
  if (name.startsWith('voice_')) return 'gnani';
  if (name.startsWith('state_')) return 'sheets';
  if (name.startsWith('gmail_')) return 'gmail';
  if (name.startsWith('razorpay_') || name === 'payment_reconcile') return 'razorpay';
  if (name.startsWith('delhivery_') || name === 'pharmacy_stock_lookup') return 'delhivery';
  return 'postgres';
}

// PUBLIC_INTERFACE
export function toolCatalog() {
  /** Return the provisional allowlist with explicit local refill effects; partner/platform freeze remains gated. */
  const refillDescriptions: Record<string, string> = {
    refill_request_get: 'Read this sender’s local refill request under a current lease and claimed event, including its manual review packet when PENDING_HANDOFF. No operator assignment or dispatch is verified. Does not verify stock, payment, pharmacy acceptance or fulfillment.',
    refill_request_prepare: 'Write an owned local request from a current pharmacy lookup and explicit medicine, strength, quantity and prescription reference. May require clarification; otherwise returns AWAITING_CONFIRMATION and a ten-minute token. Evidence is not clinically verified and no order is placed.',
    refill_request_confirm: 'Write PENDING_HANDOFF and an owned MANUAL review packet only after a new same-sender token-bound confirmation event. Required checks do not authorize an operator or verify dispatch. May acknowledge a Telegram callback. Does not purchase medicine or verify pharmacy acceptance; fulfillment_verified remains false.',
    pharmacy_nearby_lookup: 'Discover nearby pharmacy candidates from a current consent-bound location event. Consumes the location reference and persists lookup evidence, so this is not a read-only operation. Candidates do not prove medicine stock or fulfillment.'
  };
  return Object.entries(schemas).map(([name, schema]) => ({
    name, description: refillDescriptions[name] ??
      `${name}: mechanical ${service(name as ToolName)} operation. Provisional contract; provider implementations and live verification are incomplete.`,
    ...(Object.hasOwn(refillDescriptions, name) ? { annotations: {
      readOnlyHint: name === 'refill_request_get',
      destructiveHint: name === 'pharmacy_nearby_lookup',
      idempotentHint: name === 'refill_request_get' || name.startsWith('refill_request_'),
      openWorldHint: name === 'pharmacy_nearby_lookup' || name === 'refill_request_confirm'
    } } : {}),
    inputSchema: zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' })
  }));
}

// PUBLIC_INTERFACE
export async function dispatchTool(name: string, input: unknown, config: Config, dependencies: Dependencies) {
  /** Validate every call and durably audit before dispatch; do not imitate unconfigured real services. */
  const requestId = randomUUID();
  const started = performance.now();
  let begun = false;
  let code = 'UPSTREAM_ERROR';
  let result: unknown;
  let rawRail = false;
  let replayed = false;
  try {
    if (!dependencies.audit || !config.mcpKey) throw new ToolError('AUDIT_UNAVAILABLE', 'Durable audit is unavailable');
    const known = Object.hasOwn(schemas, name);
    const tool = name as ToolName;
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const run = typeof raw.run_id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(raw.run_id) ? raw.run_id : null;
    try {
      await dependencies.audit.begin({ request_id: requestId,
        run_id: run, connector_identity: 'mcp-bearer', tool: known ? tool : 'UNKNOWN_TOOL',
        args_digest: auditDigest(input, config.mcpKey), real_service: known ? service(tool) : 'none' });
      begun = true;
    } catch { throw new ToolError('AUDIT_UNAVAILABLE', 'Durable audit is unavailable'); }
    if (!known) throw new ToolError('INVALID_ARGUMENT', 'Unknown tool');
    const parsed = schemas[tool].safeParse(input);
    if (!parsed.success) throw new ToolError('INVALID_ARGUMENT', 'Arguments do not match tool schema');
    const args = parsed.data as Record<string, unknown>;
    if (tool.startsWith('state_')) {
      try { validateStateArguments(tool, args); }
      catch { throw new ToolError('INVALID_ARGUMENT', 'State columns, values or rule IDs are invalid'); }
    }
    let data: unknown;
    const backend = service(tool);
    if (tool.startsWith('tg_') || tool.startsWith('voice_') || tool.startsWith('refill_request_') || tool === 'pharmacy_nearby_lookup') {
      const required = ['telegram', ...(tool.startsWith('voice_') ? ['gnani', 'audio'] : []),
        ...(tool === 'pharmacy_nearby_lookup' ? ['maps'] : []), ...(tool === 'tg_send_audio' ? ['audio'] : [])] as ServiceName[];
      if (required.some(name => !config.services[name].configured || !config.services[name].enabled) || !dependencies.revised) {
        throw new ToolError('NOT_CONFIGURED', 'Required integration is disabled, incomplete or lacks durable mechanics');
      }
      const dispatched = await dependencies.revised.dispatch(tool, args);
      data = dispatched.data;
      replayed = dispatched.replayed;
    } else if (tool === 'razorpay_get_payment_link' || tool === 'razorpay_get_payment' || tool === 'payment_reconcile') {
      if (!dependencies.paymentReads) throw new ToolError('NOT_CONFIGURED', 'Razorpay test reads unavailable');
      if (tool === 'razorpay_get_payment_link') {
        data = await dependencies.paymentReads.getLink(schemas.razorpay_get_payment_link.parse(input).payment_link_id);
        rawRail = true;
      } else if (tool === 'razorpay_get_payment') {
        data = await dependencies.paymentReads.getPayment(schemas.razorpay_get_payment.parse(input).payment_id);
        rawRail = true;
      } else {
        const args = schemas.payment_reconcile.parse(input);
        data = await dependencies.paymentReads.reconcile(args.journey_id, args.task_id, args.payment_link_id, args.payment_id);
      }
    } else if (backend !== 'postgres') {
      if (!config.services[backend].configured) throw new ToolError('NOT_CONFIGURED', 'Required service configuration is missing');
      if (backend === 'delhivery') throw new ToolError('CONTRACT_UNVERIFIED', 'Official partner response contracts remain unverified');
      throw new ToolError('NOT_IMPLEMENTED', 'Provider mechanics are not enabled in this bootstrap');
    } else {
      if (!dependencies.runs) throw new ToolError('NOT_CONFIGURED', 'Run persistence is unavailable');
      if (tool === 'run_acquire') {
        const args = schemas.run_acquire.parse(input);
        data = await dependencies.runs.acquire(args.run_id, 'mcp-bearer', args.ttl_seconds, args.lease_id);
      } else {
        const args = schemas.run_release.parse(input);
        data = await dependencies.runs.release(args.run_id, 'mcp-bearer', args.lease_id);
      }
    }
    code = 'OK';
    result = rawRail ? data : { ok: true, data, error: null, request_id: requestId, replayed };
  } catch (error) {
    code = error instanceof ToolError ? error.code : 'UPSTREAM_ERROR';
    result = failure(error, requestId);
  } finally {
    if (begun) {
      try { await dependencies.audit!.finish(requestId, code, Math.ceil(performance.now() - started)); }
      catch {
        // Preserve STARTED evidence. Never tell callers a safe retry exists after a dispatched action.
        result = failure(new ToolError('OUTCOME_UNKNOWN', 'Audit completion unavailable; reconcile before retry'), requestId);
      }
    }
  }
  return result;
}
