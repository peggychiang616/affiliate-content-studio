ALTER TABLE content_groups
  ADD COLUMN failure_reason text;

ALTER TABLE content_revisions
  ADD COLUMN parent_revision_id uuid,
  ADD COLUMN style text NOT NULL DEFAULT '簡潔溫暖',
  ADD CONSTRAINT content_revisions_parent_revision_fk
    FOREIGN KEY (owner_id, parent_revision_id)
    REFERENCES content_revisions(owner_id, id);
