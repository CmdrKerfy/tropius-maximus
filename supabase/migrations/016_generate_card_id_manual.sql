-- ============================================================
-- 016: Manual card IDs — single source of truth with `custom-` prefix
-- ============================================================
-- Replaces `generate_card_id` so it matches app `buildManualCardId` and returns
-- ids like `custom-{set}-{number}` with the same normalization as the client.

CREATE OR REPLACE FUNCTION generate_card_id(
  p_set_id TEXT,
  p_number TEXT
) RETURNS TEXT AS $$
DECLARE
  normalized_number TEXT;
  normalized_set TEXT;
  final_id TEXT;
BEGIN
  normalized_set := LOWER(TRIM(p_set_id));
  IF normalized_set = '' THEN
    RAISE EXCEPTION 'Set ID is required';
  END IF;

  normalized_number := LTRIM(TRIM(COALESCE(p_number, '')), '0');
  IF normalized_number = '' THEN
    normalized_number := '0';
  END IF;

  final_id := 'custom-' || normalized_set || '-' || normalized_number;

  IF EXISTS (SELECT 1 FROM cards WHERE id = final_id) THEN
    RAISE EXCEPTION 'Card ID "%" already exists', final_id;
  END IF;

  RETURN final_id;
END;
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION generate_card_id(TEXT, TEXT) IS
  'Manual/custom card primary key: custom-{set}-{number}, normalized; must match src/lib/manualCardId.js';

GRANT EXECUTE ON FUNCTION generate_card_id(TEXT, TEXT) TO authenticated;
