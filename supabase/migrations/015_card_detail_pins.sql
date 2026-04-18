-- ============================================================
-- 015: Card detail — ordered annotation field pins (Explore drawer)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_preferences'
      AND column_name = 'card_detail_pins'
  ) THEN
    ALTER TABLE user_preferences
      ADD COLUMN card_detail_pins JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

COMMENT ON COLUMN user_preferences.card_detail_pins IS
  'Ordered array of annotation field keys to show in Card detail pin strip (max ~12 in app).';
