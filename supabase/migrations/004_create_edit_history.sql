-- ============================================================
-- 004: Edit history — audit trail for annotation changes
-- Partitioned by quarter. No FK on card_id so history
-- survives card deletion.
-- ============================================================

CREATE TABLE edit_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY,
  card_id     TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  edited_by   UUID REFERENCES auth.users(id),
  edited_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, edited_at)
) PARTITION BY RANGE (edited_at);

-- Create partitions for 2026
CREATE TABLE edit_history_2026_q1 PARTITION OF edit_history
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
CREATE TABLE edit_history_2026_q2 PARTITION OF edit_history
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
CREATE TABLE edit_history_2026_q3 PARTITION OF edit_history
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE edit_history_2026_q4 PARTITION OF edit_history
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- 2027 partitions (create ahead of time)
CREATE TABLE edit_history_2027_q1 PARTITION OF edit_history
  FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
CREATE TABLE edit_history_2027_q2 PARTITION OF edit_history
  FOR VALUES FROM ('2027-04-01') TO ('2027-07-01');

-- Index for looking up history by card
CREATE INDEX idx_edit_history_card_id ON edit_history(card_id, edited_at DESC);
