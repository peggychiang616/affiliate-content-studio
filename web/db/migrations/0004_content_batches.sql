CREATE TABLE content_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 8 AND 128),
  preference_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, request_key),
  FOREIGN KEY (owner_id, preference_version)
    REFERENCES user_preferences(owner_id, version)
);

CREATE TABLE content_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_source_version text NOT NULL,
  variant_index smallint NOT NULL CHECK (variant_index IN (1, 2)),
  status text NOT NULL CHECK (
    status IN ('queued', 'producing', 'awaiting_review', 'blocked', 'failed', 'confirmed', 'exported')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, batch_id, product_id, variant_index),
  FOREIGN KEY (owner_id, batch_id)
    REFERENCES content_batches(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, product_id)
    REFERENCES products(owner_id, id)
);

CREATE TABLE content_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  group_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (owner_id, idempotency_key),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, group_id, attempt),
  FOREIGN KEY (owner_id, group_id)
    REFERENCES content_groups(owner_id, id) ON DELETE CASCADE
);

CREATE TABLE content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key),
  FOREIGN KEY (owner_id, batch_id)
    REFERENCES content_batches(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX content_batches_owner_created_idx ON content_batches(owner_id, created_at DESC);
CREATE INDEX content_groups_owner_batch_idx ON content_groups(owner_id, batch_id);
CREATE INDEX content_jobs_status_created_idx ON content_jobs(status, created_at);
CREATE INDEX content_events_owner_batch_idx ON content_events(owner_id, batch_id);
