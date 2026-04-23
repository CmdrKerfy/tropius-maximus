-- ============================================================
-- 039: Workbench — ordered annotation fields (separate from card_detail_pins)
-- ============================================================
-- NULL = inherit Explore card-detail pins until the user saves Workbench-specific order.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_preferences'
      AND column_name = 'workbench_pins'
  ) THEN
    ALTER TABLE user_preferences
      ADD COLUMN workbench_pins JSONB;
  END IF;
END $$;

COMMENT ON COLUMN user_preferences.workbench_pins IS
  'Ordered annotation field keys for Workbench AnnotationEditor top strip; NULL inherits card_detail_pins until first save.';
