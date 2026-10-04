import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { argumentDigest } from '../lib/digest.js';
import { ToolError } from '../lib/errors.js';
import { ownedEvent, transaction } from './ownership.js';

const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

function manualHandoff(request: Record<string, unknown>) {
  // This is an owned local review packet, not a dispatched task or operator authorization.
  // Do not include sender/chat IDs, confirmation tokens or caller-controlled completion flags.
  return {
    method: 'MANUAL',
    status: 'AWAITING_OPERATOR_REVIEW',
    reference: request.request_id,
    request: {
      place_id: request.place_id, medicine: request.medicine, strength: request.strength,
      quantity: request.quantity, prescription_ref: request.prescription_ref ?? null,
      approval_ref: request.approval_ref ?? null
    },
    operator_assigned: false,
    dispatch_verified: false,
    evidence_verified: false,
    fulfillment_verified: false,
    required_checks: ['authorized_operator', 'current_prescription_review', 'pharmacy_stock_and_acceptance',
      'price_and_payment_consent', 'collection_or_delivery_arrangement', 'order_reference_and_reconciliation'],
    message: 'Manual review only. No pharmacy order has been placed or verified by this service.'
  };
}

// PUBLIC_INTERFACE
export async function refillTool(pool: pg.Pool, bot: string, tool: string, args: Record<string, unknown>) {
  /** Perform only atomic local request transitions; input evidence references are not clinical or fulfillment verification. */
  return transaction(pool, async client => {
    const event = await ownedEvent(client, bot, args);
    const identity = [bot, event.sender_id, event.chat_id];
    if (tool === 'refill_request_get') {
      const result = await client.query(`SELECT request_id,place_id,medicine,strength,quantity,prescription_ref,approval_ref,
        CASE WHEN status='AWAITING_CONFIRMATION' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS status
        FROM refill_requests WHERE request_id=$1 AND bot_id=$2 AND sender_id=$3 AND chat_id=$4`,
      [args.request_id, ...identity]);
      if (!result.rowCount) throw new ToolError('UNAUTHORIZED', 'Request not available to this sender');
      const request = result.rows[0];
      return { data: { ...request, fulfillment_verified: false,
        ...(request.status === 'PENDING_HANDOFF' ? { manual_handoff: manualHandoff(request) } : {}) }, replayed: false };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`refill:${bot}:${tool}:${args.idempotency_key}`]);
    const digest = argumentDigest(args);
    const existing = await client.query(`SELECT args_digest,result_json FROM refill_operations
      WHERE bot_id=$1 AND tool=$2 AND operation_key=$3`, [bot, tool, args.idempotency_key]);
    if (existing.rowCount) {
      if (existing.rows[0].args_digest !== digest) throw new ToolError('CONFLICT', 'Refill key has changed payload');
      return { data: existing.rows[0].result_json, replayed: true };
    }
    let data: Record<string, unknown>;
    if (tool === 'refill_request_prepare') {
      const lookup = await client.query(`SELECT place_ids FROM pharmacy_lookups WHERE lookup_ref=$1
        AND bot_id=$2 AND sender_id=$3 AND chat_id=$4 AND source_update_id=$5 AND expires_at>now()`,
      [args.lookup_ref, ...identity, event.update_id]);
      if (!lookup.rowCount || !lookup.rows[0].place_ids.includes(args.place_id)) {
        throw new ToolError('LOCATION_UNAVAILABLE', 'Select a candidate from the current owned lookup');
      }
      if (!args.prescription_ref) {
        data = { pending_clarification: true, required: ['current_prescription_evidence'],
          fulfillment_verified: false };
      } else {
        const request = randomUUID(), token = randomUUID();
        const inserted = await client.query(`INSERT INTO refill_requests
          (request_id,bot_id,sender_id,chat_id,source_update_id,place_id,medicine,strength,quantity,
           prescription_ref,approval_ref,token_digest,status,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'AWAITING_CONFIRMATION',now()+interval '10 minutes')
          ON CONFLICT DO NOTHING RETURNING request_id`,
        [request, ...identity, event.update_id, args.place_id, args.medicine, args.strength, args.quantity,
          args.prescription_ref, args.approval_ref ?? null, tokenDigest(token)]);
        if (!inserted.rowCount) throw new ToolError('CONFLICT', 'Source already has a local request; retrieve it instead');
        data = { request_id: request, status: 'AWAITING_CONFIRMATION', confirmation_token: token,
          expires_in_seconds: 600, fulfillment_verified: false, evidence_verified: false };
      }
    } else if (tool === 'refill_request_confirm') {
      const found = await client.query(`SELECT * FROM refill_requests WHERE request_id=$1
        AND bot_id=$2 AND sender_id=$3 AND chat_id=$4 FOR UPDATE`, [args.request_id, ...identity]);
      const request = found.rows[0];
      const supplied = String(args.token);
      const validEvent = (event.kind === 'callback' && event.token === supplied) ||
        (event.kind === 'text' && event.text === `/confirm ${supplied}`);
      if (!request || request.token_digest !== tokenDigest(supplied) || !validEvent ||
          request.source_update_id === event.update_id ||
          new Date(event.event_at).getTime() < new Date(request.expires_at).getTime() - 600000 ||
          Date.now() - new Date(event.event_at).getTime() > 600000) {
        throw new ToolError('CONFIRMATION_INVALID', 'New bound confirmation event required');
      }
      if (request.status === 'PENDING_HANDOFF') {
        data = { request_id: request.request_id, status: 'PENDING_HANDOFF', fulfillment_verified: false,
          manual_handoff: manualHandoff(request) };
      } else {
        if (request.status !== 'AWAITING_CONFIRMATION' || new Date(request.expires_at).getTime() <= Date.now()) {
          throw new ToolError('CONFIRMATION_INVALID', 'Confirmation expired or no longer pending');
        }
        await client.query(`UPDATE refill_requests SET status='PENDING_HANDOFF',version=version+1,
          confirmed_update_id=$2,confirmed_at=now() WHERE request_id=$1`, [args.request_id, event.update_id]);
        data = { request_id: request.request_id, status: 'PENDING_HANDOFF',
          fulfillment_verified: false, manual_handoff: manualHandoff(request),
          message: 'Request recorded; manual pharmacy confirmation is still required.' };
      }
    } else {
      throw new ToolError('INVALID_ARGUMENT', 'Unknown local request operation');
    }
    await client.query(`INSERT INTO refill_operations(bot_id,tool,operation_key,args_digest,result_json)
      VALUES ($1,$2,$3,$4,$5)`, [bot, tool, args.idempotency_key, digest, JSON.stringify(data)]);
    return { data, replayed: false };
  });
}
