-- ============================================================
-- 005: Normalization rules + health check results
-- ============================================================

-- Normalization rules (applied in app layer + nightly safety net)
CREATE TABLE normalization_rules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  field_name    TEXT,               -- NULL = applies to all fields
  match_pattern TEXT NOT NULL,
  replace_with  TEXT NOT NULL,
  rule_type     TEXT DEFAULT 'exact',
  created_at    TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_rule_type CHECK (rule_type IN ('exact', 'contains', 'regex'))
);

-- Health check results (pre-computed by scheduled job)
CREATE TABLE health_check_results (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_type  TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  checked_at  TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_severity CHECK (severity IN ('critical', 'warning', 'info'))
);

CREATE INDEX idx_health_check_type ON health_check_results(check_type, checked_at DESC);
