CREATE TABLE IF NOT EXISTS wa_inbox (
  message_id text PRIMARY KEY,
  from_number text NOT NULL,
  from_name text,
  type text NOT NULL CHECK (type IN ('text','audio','button_reply','other')),
  text text,
  media_id text,
  button_id text,
  wa_timestamp timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CLAIMED','DONE')),
  claimed_by_run text,
  claimed_by_owner text,
  lease_id uuid,
  lease_expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS wa_inbox_claim ON wa_inbox(status, received_at);
CREATE TABLE IF NOT EXISTS wa_contact_windows (
  from_number text PRIMARY KEY,
  last_inbound_at timestamptz NOT NULL
);
