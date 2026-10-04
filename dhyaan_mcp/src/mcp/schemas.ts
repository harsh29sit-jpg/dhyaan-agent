import { z } from 'zod';
import { decisionFields } from './state-schemas.js';

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const text = z.string().min(1).max(8000);
const key = z.string().min(1).max(160);
const language = z.string().min(2).max(20);
const chat = z.string().regex(/^[1-9]\d{0,15}$/).refine(v => Number.isSafeInteger(Number(v)));
const updateId = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(v => Number.isSafeInteger(Number(v)));
const pin = z.string().regex(/^\d{6}$/);
const count = z.number().int().min(1).max(100).default(20);
const lease = { run_id: id, lease_id: z.string().uuid() };
const mutation = { ...lease, idempotency_key: key };
const cell = z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]);
const row = z.record(z.string().min(1).max(80), cell);
export const tab = z.enum(['family_members', 'patients', 'prescriptions', 'medicine_supply', 'policies',
  'appointments', 'care_journeys', 'care_tasks', 'approvals', 'orders', 'events', 'decision_log', 'agent_state']);
const shipment = z.object({
  name: z.string().min(1).max(100), order: id, phone: z.string().regex(/^\+?[1-9]\d{7,14}$/),
  add: z.string().min(1).max(500), pin,
  payment_mode: z.enum(['Prepaid', 'COD']), city: z.string().max(100).optional(),
  state: z.string().max(100).optional(), country: z.string().max(100).optional(),
  products_desc: text.optional(), total_amount: z.number().nonnegative().optional(),
  weight: z.number().positive().optional(), waybill: id.optional(), shipping_mode: z.enum(['Express', 'Surface']).optional()
}).strict();

export const schemas = {
  run_acquire: z.object({ run_id: id, lease_id: z.string().uuid().optional(), ttl_seconds: z.number().int().min(30).max(300).default(300) }).strict(),
  run_release: z.object(lease).strict(),
  tg_get_new_messages: z.object({ ...lease, limit: count }).strict(),
  tg_ack_messages: z.object({ ...lease, update_ids: z.array(updateId).min(1).max(100) }).strict(),
  tg_send_text: z.object({ ...mutation, source_update_id: updateId, chat_id: chat, text: z.string().min(1).max(4096) }).strict(),
  tg_send_buttons: z.object({ ...mutation, source_update_id: updateId, chat_id: chat, text: z.string().min(1).max(4096),
    buttons: z.array(z.object({ token: z.string().uuid(), title: z.string().min(1).max(64) }).strict()).min(1).max(8) }).strict(),
  tg_request_location: z.object({ ...mutation, source_update_id: updateId, chat_id: chat, purpose: z.literal('pharmacy_lookup') }).strict(),
  tg_send_audio: z.object({ ...mutation, source_update_id: updateId, chat_id: chat, audio_ref: z.string().uuid() }).strict(),
  voice_transcribe: z.object({ ...lease, source_update_id: updateId, audio_ref: z.string().uuid(), language_code: language }).strict(),
  voice_synthesize: z.object({ ...mutation, source_update_id: updateId, text: z.string().min(1).max(2000),
    language_code: language, voice: z.literal('Nalini') }).strict(),
  pharmacy_nearby_lookup: z.object({ ...lease, source_update_id: updateId, location_ref: z.string().uuid(),
    radius_m: z.number().int().min(100).max(10000).default(3000), limit: z.number().int().min(1).max(20).default(5) }).strict(),
  refill_request_prepare: z.object({ ...mutation, source_update_id: updateId, lookup_ref: z.string().uuid(), place_id: id,
    medicine: z.string().trim().min(1).max(200), strength: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(1000), prescription_ref: id.optional(), approval_ref: id.optional() }).strict(),
  refill_request_confirm: z.object({ ...mutation, source_update_id: updateId, request_id: z.string().uuid(),
    token: z.string().uuid() }).strict(),
  refill_request_get: z.object({ ...lease, source_update_id: updateId, request_id: z.string().uuid() }).strict(),
  state_read: z.object({ tab, where: row.optional(), limit: count }).strict(),
  state_append: z.object({ ...mutation, tab, row }).strict(),
  state_update: z.object({ ...mutation, tab, id, patch: row, expected_version: z.number().int().positive() }).strict(),
  state_log_decision: z.object({ ...mutation, ...decisionFields }).strict(),
  gmail_read_inbox: z.object({ ...lease, query: z.string().max(1000).optional(), limit: count, page_token: z.string().max(2048).optional() }).strict(),
  gmail_search_emails: z.object({ query: z.string().min(1).max(1000), limit: count, page_token: z.string().max(2048).optional() }).strict(),
  gmail_get_message: z.object({ message_id: id }).strict(),
  gmail_get_thread: z.object({ thread_id: id }).strict(),
  gmail_ack_messages: z.object({ ...lease, message_ids: z.array(id).min(1).max(100) }).strict(),
  gmail_send_email: z.object({ to: z.string().email().max(254), subject: z.string().min(1).max(998).regex(/^[^\r\n]*$/),
    body_text: text, thread_id: id.optional(), idempotency_key: key }).strict(),
  razorpay_create_payment_link: z.object({ journey_id: id, task_id: id, order_ref: id,
    amount_inr: z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 100)),
    currency: z.literal('INR'), idempotency_key: key }).strict(),
  razorpay_get_payment_link: z.object({ payment_link_id: id }).strict(),
  razorpay_cancel_payment_link: z.object({ payment_link_id: id, idempotency_key: key }).strict(),
  razorpay_get_payment: z.object({ payment_id: id }).strict(),
  payment_reconcile: z.object({ journey_id: id, task_id: id, payment_link_id: id, payment_id: id.optional() }).strict(),
  delhivery_pincode_serviceability: z.object({ filter_codes: pin }).strict(),
  delhivery_create_shipment: z.object({ shipments: z.array(shipment).min(1).max(50),
    pickup_location: z.object({ name: z.string().min(1).max(100) }).strict(), idempotency_key: key }).strict(),
  delhivery_track_shipment: z.object({ waybill: z.string().min(1).max(2000).optional(), ref_ids: id.optional() }).strict()
    .refine(v => Boolean(v.waybill) !== Boolean(v.ref_ids), 'Supply waybill or ref_ids, not both'),
  delhivery_shipping_cost: z.object({ md: z.enum(['E', 'S']), cgm: z.number().positive(), o_pin: pin, d_pin: pin,
    ss: z.enum(['Delivered', 'RTO', 'DTO']), pt: z.enum(['Pre-paid', 'COD']),
    l: z.number().positive().optional(), b: z.number().positive().optional(), h: z.number().positive().optional(),
    ipkg_type: id.optional() }).strict(),
  delhivery_ndr_action: z.object({ data: z.array(z.object({ waybill: id, act: z.enum(['RE-ATTEMPT', 'PICKUP_RESCHEDULE']) }).strict()).min(1).max(50),
    idempotency_key: key }).strict(),
  delhivery_ndr_status: z.object({ upl_id: id, verbose: z.boolean().default(true) }).strict(),
  pharmacy_stock_lookup: z.object({ medicine: z.string().min(1).max(200), strength: z.string().min(1).max(100), pin }).strict()
} as const;
export type ToolName = keyof typeof schemas;
