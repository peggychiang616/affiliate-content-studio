CREATE TABLE user_preferences (
  owner_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  audience text NOT NULL CHECK (char_length(audience) BETWEEN 2 AND 120),
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 2 AND 120),
  voice text NOT NULL CHECK (char_length(voice) BETWEEN 2 AND 80),
  default_style text NOT NULL CHECK (char_length(default_style) BETWEEN 2 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, version)
);
