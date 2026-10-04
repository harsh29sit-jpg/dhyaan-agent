import { z } from 'zod';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Resolve from application root in source and compiled layouts without bundling secret configuration.
const sourceCatalog = new URL('../../contracts/rule-ids.json', import.meta.url);
const ruleCatalog = require(fileURLToPath(existsSync(sourceCatalog) ? sourceCatalog :
  new URL('../../../contracts/rule-ids.json', import.meta.url))) as { ids: string[] };
const short = z.string().max(500);
const text = z.string().max(8000);
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const timestamp = z.string().datetime({ offset: true });
const optionalTimestamp = z.union([timestamp, z.literal('')]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bool = z.union([z.boolean(), z.enum(['TRUE', 'FALSE'])]);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pin = z.string().regex(/^\d{6}$/);
const ruleId = z.string().refine(value => ruleCatalog.ids.includes(value), 'Unknown rule ID');
export const decisionFields = {
  decision_id: id, ts: timestamp, journey_id: id, input_received: text, source_connector: id,
  real_source: id, decision: text, rule_id: ruleId, policy_outcome: z.enum(['ACT', 'ASK', 'STOP', 'NA']),
  action_or_message: text, recipient: short, through_connector: id, tool_called: id
};
export const stateRows = {
  family_members: z.object({ member_id: id, name: short, relation: short, roles: short,
    whatsapp_number: z.string().regex(/^\+[1-9]\d{7,14}$/), language: short, timezone: short,
    city: short, pincode: pin, is_local_to_patient: bool, active: bool }).strict(),
  patients: z.object({ patient_id: id, member_id: id, age: z.number().int().min(0).max(130),
    conditions: text, address: short, pincode: pin, preferred_language: short }).strict(),
  prescriptions: z.object({ rx_id: id, patient_id: id, medicine_name: short, strength: short,
    dose_per_day: z.number().positive(), prescriber: short, valid_until: date,
    permitted_alternatives: text, source: short }).strict(),
  medicine_supply: z.object({ supply_id: id, rx_id: id, units_on_hand: z.number().nonnegative(),
    days_left: z.number().nonnegative(), reorder_threshold_days: z.number().nonnegative(),
    last_refill_date: z.union([date, z.literal('')]), next_refill_date: z.union([date, z.literal('')]) }).strict(),
  policies: z.object({ policy_id: id, auto_auth_limit_inr: money, primary_approver_id: id, backup_approver_id: id,
    approval_timeout_min: z.number().positive(), reminder_after_min: z.number().positive(),
    consent_payments: bool, consent_data_sharing: bool }).strict(),
  appointments: z.object({ appt_id: id, patient_id: id, hospital: short, city: short, doctor_specialty: short,
    scheduled_at: timestamp, status: short }).strict(),
  care_journeys: z.object({ journey_id: id, patient_id: id, type: z.enum(['MEDICINE_REFILL', 'APPOINTMENT']),
    goal: text, status: z.enum(['UNDERSTAND', 'IDENTIFY_NEED', 'PLAN', 'POLICY_CHECK', 'EXECUTE',
      'AWAITING_APPROVAL', 'ESCALATED', 'ON_HOLD', 'VERIFY', 'RECOVERY', 'COMPLETE', 'FAILED']),
    deadline: timestamp, created_at: timestamp, closed_at: optionalTimestamp }).strict(),
  care_tasks: z.object({ task_id: id, journey_id: id, type: short,
    status: z.enum(['PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL', 'DONE', 'FAILED', 'INVALIDATED', 'CANCELLED']),
    owner: id, depends_on: short, deadline: timestamp, evidence_ref: text, updated_at: timestamp }).strict(),
  approvals: z.object({ approval_id: id, task_id: id, approver_id: id, amount_inr: money,
    reason: text, options: text, status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED']),
    requested_at: timestamp, reminded_at: optionalTimestamp, responded_at: optionalTimestamp, wa_message_id: short }).strict(),
  orders: z.object({ order_id: id, journey_id: id, pickup_location: short, items: text,
    medicine_cost_inr: money, shipping_cost_inr: money, total_inr: money,
    payment_ref: short, receipt_ref: short, payment_status: short, waybill: short, shipment_status: short }).strict(),
  events: z.object({ event_id: id, ts: timestamp, source: z.enum(['whatsapp', 'gmail', 'delhivery', 'razorpay', 'gnani', 'agent']),
    type: short, summary: text, journey_id: z.union([id, z.literal('')]), external_ref: short }).strict(),
  decision_log: z.object(decisionFields).strict(),
  agent_state: z.object({ key: id, value: text, updated_at: timestamp }).strict()
} as const;

const primaryKeys = {
  family_members: 'member_id', patients: 'patient_id', prescriptions: 'rx_id', medicine_supply: 'supply_id',
  policies: 'policy_id', appointments: 'appt_id', care_journeys: 'journey_id', care_tasks: 'task_id',
  approvals: 'approval_id', orders: 'order_id', events: 'event_id', decision_log: 'decision_id', agent_state: 'key'
} as const;

// PUBLIC_INTERFACE
export function validateStateArguments(tool: string, args: Record<string, unknown>): void {
  /** Enforce columns/types/rule IDs only; policy and care decisions remain exclusively in the agent. */
  if (tool === 'state_log_decision') {
    const { run_id: _run, lease_id: _lease, idempotency_key: _key, ...decision } = args;
    void _run; void _lease; void _key;
    stateRows.decision_log.parse(decision);
    return;
  }
  const tab = args.tab as keyof typeof stateRows;
  const schema = stateRows[tab];
  if (!schema) throw new Error('Unknown state tab');
  if (tool === 'state_append') schema.parse(args.row);
  if (tool === 'state_read' && args.where) schema.partial().strict().parse(args.where);
  if (tool === 'state_update') {
    const patch = args.patch as Record<string, unknown>;
    if (Object.keys(patch).length === 0 || primaryKeys[tab] in patch) throw new Error('Empty patch or primary key mutation');
    schema.partial().strict().parse(patch);
  }
}
