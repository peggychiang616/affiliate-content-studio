CREATE TABLE principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  source_provider text NOT NULL,
  source_external_id text NOT NULL,
  source_uri text NOT NULL,
  source_version text NOT NULL,
  source_checked_at timestamptz NOT NULL,
  data_valid_until timestamptz NOT NULL,
  title text NOT NULL,
  eligibility_status text NOT NULL CHECK (eligibility_status IN ('eligible', 'ineligible')),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source_provider, source_external_id),
  UNIQUE (owner_id, id),
  CHECK (NOT is_synthetic OR eligibility_status <> 'eligible')
);

CREATE TABLE product_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL,
  fact_key text NOT NULL,
  fact_value text NOT NULL,
  source_reference text NOT NULL,
  source_version text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, product_id) REFERENCES products(owner_id, id) ON DELETE CASCADE,
  UNIQUE (owner_id, product_id, fact_key, source_version)
);

CREATE TABLE product_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  product_id uuid NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('image', 'video')),
  source_uri text NOT NULL,
  source_version text NOT NULL,
  rights_provider text NOT NULL,
  rights_status text NOT NULL CHECK (rights_status IN ('unknown', 'verified', 'expired', 'out_of_scope')),
  allowed_uses text[] NOT NULL DEFAULT '{}',
  rights_verified_at timestamptz,
  rights_valid_until timestamptz,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, product_id) REFERENCES products(owner_id, id) ON DELETE CASCADE,
  CHECK (NOT is_synthetic OR rights_status <> 'verified'),
  CHECK (rights_status <> 'verified' OR rights_verified_at IS NOT NULL)
);

CREATE INDEX products_owner_eligibility_idx ON products(owner_id, eligibility_status);
CREATE INDEX product_facts_owner_product_idx ON product_facts(owner_id, product_id);
CREATE INDEX product_assets_owner_product_idx ON product_assets(owner_id, product_id);
