ALTER TABLE product_assets
  ADD CONSTRAINT product_assets_owner_id_key UNIQUE (owner_id, id);

ALTER TABLE content_revisions
  ADD CONSTRAINT content_revisions_owner_group_id_key
    UNIQUE (owner_id, group_id, id);

CREATE TABLE content_video_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  source_asset_id uuid NOT NULL,
  product_source_version text NOT NULL,
  media_uri text NOT NULL,
  media_type text NOT NULL,
  duration_seconds numeric(5, 2) NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  playable boolean NOT NULL,
  audio_present boolean NOT NULL,
  subtitles_within_safe_area boolean NOT NULL,
  max_audio_video_offset_ms integer NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, revision_id),
  FOREIGN KEY (owner_id, group_id)
    REFERENCES content_groups(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, group_id, revision_id)
    REFERENCES content_revisions(owner_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, source_asset_id)
    REFERENCES product_assets(owner_id, id),
  CHECK (duration_seconds >= 0),
  CHECK (max_audio_video_offset_ms >= 0)
);

CREATE TABLE content_revision_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, revision_id),
  FOREIGN KEY (owner_id, group_id)
    REFERENCES content_groups(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, group_id, revision_id)
    REFERENCES content_revisions(owner_id, group_id, id) ON DELETE CASCADE
);

CREATE TABLE content_revision_previews (
  owner_id uuid NOT NULL,
  group_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  previewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, revision_id),
  FOREIGN KEY (owner_id, group_id)
    REFERENCES content_groups(owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, group_id, revision_id)
    REFERENCES content_revisions(owner_id, group_id, id) ON DELETE CASCADE
);

CREATE INDEX content_video_artifacts_owner_group_idx
  ON content_video_artifacts(owner_id, group_id);
CREATE INDEX content_revision_reviews_owner_group_idx
  ON content_revision_reviews(owner_id, group_id);
