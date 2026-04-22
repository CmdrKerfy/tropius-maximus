-- ============================================================
-- 033: Add jumbo_card annotation support
-- ============================================================

ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS jumbo_card BOOLEAN DEFAULT FALSE;

UPDATE public.annotations
SET jumbo_card = FALSE
WHERE jumbo_card IS NULL;

INSERT INTO public.field_definitions (name, label, field_type, category, sort_order, curated_options)
VALUES ('jumbo_card', 'Jumbo Card', 'boolean', 'collection', 30, '[]'::jsonb)
ON CONFLICT (name) DO UPDATE
SET
  label = EXCLUDED.label,
  field_type = EXCLUDED.field_type,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  curated_options = EXCLUDED.curated_options;
