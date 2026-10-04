CREATE TABLE IF NOT EXISTS telegram_inbox (
  bot_id text NOT NULL, update_id text NOT NULL,
  sender_id text NOT NULL, chat_id text NOT NULL, message_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','voice','location','callback')),
  event_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  text text, callback_id text, token text, audio_ref uuid, location_ref uuid,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CLAIMED','DONE')),
  claimed_by_run text, claimed_by_owner text, lease_id uuid, lease_expires_at timestamptz,
  PRIMARY KEY (bot_id, update_id)
);
CREATE TABLE IF NOT EXISTS telegram_location_requests (
  request_id uuid PRIMARY KEY, bot_id text NOT NULL, sender_id text NOT NULL, chat_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose='pharmacy_lookup'),
  requested_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  operation_key text NOT NULL, UNIQUE(bot_id, operation_key)
);
CREATE TABLE IF NOT EXISTS telegram_locations (
  location_ref uuid PRIMARY KEY, bot_id text NOT NULL, sender_id text NOT NULL, chat_id text NOT NULL,
  update_id text NOT NULL, latitude double precision, longitude double precision,
  expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
  CHECK (latitude BETWEEN -90 AND 90), CHECK (longitude BETWEEN -180 AND 180),
  UNIQUE(bot_id, update_id)
);
CREATE TABLE IF NOT EXISTS private_audio (
  audio_ref uuid PRIMARY KEY, bot_id text NOT NULL, sender_id text NOT NULL, chat_id text NOT NULL,
  source_update_id text NOT NULL, object_key text, file_id text, duration_seconds integer,
  media_type text NOT NULL, expires_at timestamptz NOT NULL,
  CHECK (duration_seconds BETWEEN 1 AND 60)
);
CREATE TABLE IF NOT EXISTS pharmacy_lookups (
  lookup_ref uuid PRIMARY KEY, bot_id text NOT NULL, sender_id text NOT NULL, chat_id text NOT NULL,
  source_update_id text NOT NULL, place_ids text[] NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS refill_requests (
  request_id uuid PRIMARY KEY, bot_id text NOT NULL, sender_id text NOT NULL, chat_id text NOT NULL,
  source_update_id text NOT NULL, place_id text NOT NULL,
  medicine text NOT NULL, strength text NOT NULL, quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  prescription_ref text, approval_ref text, token_digest text NOT NULL, version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('AWAITING_CONFIRMATION','PENDING_HANDOFF','CANCELLED','EXPIRED')),
  expires_at timestamptz NOT NULL, confirmed_update_id text, confirmed_at timestamptz,
  UNIQUE(bot_id, source_update_id), UNIQUE(bot_id, confirmed_update_id)
);
-- Local mutations commit their replay result in the same transaction as the state change.
CREATE TABLE IF NOT EXISTS refill_operations (
  bot_id text NOT NULL, tool text NOT NULL, operation_key text NOT NULL,
  args_digest text NOT NULL, result_json jsonb NOT NULL,
  PRIMARY KEY(bot_id,tool,operation_key)
);
CREATE INDEX IF NOT EXISTS telegram_claim_queue ON telegram_inbox(bot_id,status,received_at);
CREATE INDEX IF NOT EXISTS telegram_location_expiry ON telegram_locations(expires_at);
