-- ============================================================
-- 023: FK cards / annotations → profiles (PostgREST embed for grid)
-- ============================================================
-- Re-targets created_by / updated_by from auth.users to public.profiles
-- so PostgREST can embed profiles(display_name) in one query (Phase 3).
-- Referential integrity: every non-null FK must exist in profiles.

-- 1) Ensure profile rows exist for any referenced auth users
INSERT INTO public.profiles (id, display_name)
SELECT DISTINCT u.id, split_part(COALESCE(u.email, ''), '@', 1)
FROM auth.users u
WHERE (
    EXISTS (SELECT 1 FROM public.cards c WHERE c.created_by = u.id)
    OR EXISTS (SELECT 1 FROM public.annotations a WHERE a.updated_by = u.id)
  )
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- 2) Orphan UUIDs (no auth user / no profile): clear FKs so ALTER succeeds
UPDATE public.cards c
SET created_by = NULL
WHERE c.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.created_by);

UPDATE public.annotations a
SET updated_by = NULL
WHERE a.updated_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.updated_by);

-- 3) Drop FKs to auth.users (default names from 001 / 002)
ALTER TABLE public.cards DROP CONSTRAINT IF EXISTS cards_created_by_fkey;
ALTER TABLE public.annotations DROP CONSTRAINT IF EXISTS annotations_updated_by_fkey;

-- 4) Point at profiles (id mirrors auth.users)
ALTER TABLE public.cards
  ADD CONSTRAINT cards_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles (id)
  ON DELETE SET NULL;

ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES public.profiles (id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT cards_created_by_fkey ON public.cards IS
  'Phase 3: PostgREST embed profiles!cards_created_by_fkey on Explore grid.';
COMMENT ON CONSTRAINT annotations_updated_by_fkey ON public.annotations IS
  'Phase 3: PostgREST embed profiles!annotations_updated_by_fkey with annotations.';
