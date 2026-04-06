-- Numeric ordering for card numbers (TEXT column sorts as 1, 100, 110, 2…).
-- Matches DuckDB: first segment before '/', cast to integer when it is all digits.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS number_sort_key integer
  GENERATED ALWAYS AS (
    CASE
      WHEN trim(split_part(COALESCE(number, ''), '/', 1)) ~ '^[0-9]+$'
      THEN trim(split_part(COALESCE(number, ''), '/', 1))::integer
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_cards_number_sort_key ON cards (number_sort_key);

COMMENT ON COLUMN cards.number_sort_key IS
  'Leading numeric part of number (before /), for ORDER BY; NULL if non-numeric.';
