CREATE TABLE IF NOT EXISTS provider_webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  body_digest text NOT NULL,
  event_type text NOT NULL,
  payment_id text,
  payment_link_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE TABLE IF NOT EXISTS razorpay_links (
  payment_link_id text PRIMARY KEY,
  journey_id text NOT NULL,
  task_id text NOT NULL,
  reference_id text NOT NULL UNIQUE CHECK (length(reference_id)<=40),
  amount_paise bigint NOT NULL CHECK (amount_paise>0 AND amount_paise<=9007199254740991),
  provider_order_id text,
  operation_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, task_id)
);
