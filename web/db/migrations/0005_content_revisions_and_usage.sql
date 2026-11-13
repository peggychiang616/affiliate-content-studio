CREATE TABLE content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  group_id uuid NOT NULL,
  job_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  product_source_version text NOT NULL,
  preference_version integer NOT NULL,
  source_facts jsonb NOT NULL,
  caption text NOT NULL,
  script text NOT NULL,
  subtitles text[] NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, group_id, revision),
  FOREIGN KEY (owner_id, group_id)
    REFERENCES content_groups(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, job_id)
    REFERENCES content_jobs(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, preference_version)
    REFERENCES user_preferences(owner_id, version)
);

CREATE TABLE provider_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  job_id uuid NOT NULL,
  provider_kind text NOT NULL CHECK (
    provider_kind IN ('productData', 'assets', 'text', 'speech', 'rendering')
  ),
  provider_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  input_units integer NOT NULL CHECK (input_units >= 0),
  output_units integer NOT NULL CHECK (output_units >= 0),
  cost_amount numeric(12, 6),
  currency text,
  cost_known boolean NOT NULL,
  failure_code text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, job_id, provider_kind),
  FOREIGN KEY (owner_id, job_id)
    REFERENCES content_jobs(owner_id, id) ON DELETE CASCADE,
  CHECK (cost_amount IS NULL OR cost_amount >= 0),
  CHECK (
    (cost_known AND cost_amount IS NOT NULL AND currency ~ '^[A-Z]{3}$')
    OR
    (NOT cost_known AND cost_amount IS NULL AND currency IS NULL)
  )
);

CREATE INDEX content_revisions_owner_group_idx
  ON content_revisions(owner_id, group_id, revision DESC);
CREATE INDEX provider_usage_events_owner_job_idx
  ON provider_usage_events(owner_id, job_id);
