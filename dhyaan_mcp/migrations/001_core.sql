CREATE TABLE IF NOT EXISTS tool_call_log (
  request_id uuid PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  run_id text,
  connector_identity text NOT NULL,
  tool text NOT NULL,
  args_digest text NOT NULL,
  real_service text NOT NULL,
  result_code text NOT NULL,
  latency_ms integer,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tool_call_log_run_ts ON tool_call_log(run_id, ts);

CREATE TABLE IF NOT EXISTS agent_run_leases (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  run_id text NOT NULL,
  owner text NOT NULL,
  lease_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_operations (
  tool text NOT NULL,
  operation_key text NOT NULL,
  logical_key text,
  args_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('RESERVED','DISPATCHED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool, operation_key),
  UNIQUE (tool, logical_key)
);
