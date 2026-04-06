-- ============================================================
-- 006: User preferences — per-user UI configuration
-- ============================================================

CREATE TABLE user_preferences (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  quick_fields    JSONB DEFAULT '["art_style", "pose", "emotion", "environment", "owned"]',
  default_category TEXT DEFAULT 'general',
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Workbench queues — persist across sessions
CREATE TABLE workbench_queues (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  card_ids        JSONB NOT NULL DEFAULT '[]',
  fields          JSONB NOT NULL DEFAULT '[]',  -- which annotation fields to show
  current_index   INT DEFAULT 0,
  filters_used    JSONB DEFAULT '{}',           -- snapshot of filters that created this queue
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_queues_user ON workbench_queues(user_id);
