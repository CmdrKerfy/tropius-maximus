-- ============================================================
-- 003: Field definitions — drives dynamic form rendering
-- ============================================================

CREATE TABLE field_definitions (
  name            TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  field_type      TEXT NOT NULL DEFAULT 'select',
  category        TEXT NOT NULL DEFAULT 'general',
  sort_order      INT DEFAULT 0,
  curated_options JSONB DEFAULT '[]',
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_field_type CHECK (field_type IN ('select', 'multi_select', 'text', 'boolean', 'url'))
);
