-- Give the manual "Bulbasaur Deck" and "Squirtle Deck" cards their own custom sets
-- (owner-approved 2026-09-27). One-time data change.
--
-- Why: the Add Card form derived Set IDs from initials ("Bulbasaur Deck" -> "bd"), and
-- ensureManualSetRow ignores an existing row, so 13 manual "Japan Exclusive" cards
-- (2026-05-13) joined PTCG-db's unrelated Japanese sets: bd = "Bd: Battle Starter Deck
-- (Torterra)", sd = "SD: V Starter Decks". Since the Japanese sets were named
-- (20260927072333), the TCG/Custom Set filters list these cards under those names.
-- The form now reuses custom sets by name and never derives a taken ID
-- (src/lib/customSetId.js), so the same name resolves to these new sets from now on.
--
-- What it does, in one transaction:
--   1. Insert custom (origin 'manual') sets custom-bulbasaur-deck "Bulbasaur Deck" and
--      custom-squirtle-deck "Squirtle Deck" (no series, like "Chikorita Deck" / cd).
--   2. Move the 8 + 5 manual cards from bd / sd to them. Card IDs (custom-bd-1, ...),
--      annotations and names are unchanged; ptcgdb cards on bd / sd are not touched.
--   3. Check (abort on mismatch) and refresh explore_filter_options.
-- Idempotent: a second run moves nothing and passes the same checks.
--
-- Undo:
--   BEGIN;
--   UPDATE public.cards SET set_id = 'bd' WHERE origin = 'manual' AND set_id = 'custom-bulbasaur-deck';
--   UPDATE public.cards SET set_id = 'sd' WHERE origin = 'manual' AND set_id = 'custom-squirtle-deck';
--   DELETE FROM public.sets WHERE id IN ('custom-bulbasaur-deck', 'custom-squirtle-deck') AND origin = 'manual';
--   SELECT public.refresh_explore_filter_options();
--   COMMIT;

BEGIN;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.sets
   WHERE id IN ('custom-bulbasaur-deck', 'custom-squirtle-deck') AND origin <> 'manual';
  IF n <> 0 THEN RAISE EXCEPTION 'a new set ID already belongs to another origin'; END IF;

  SELECT count(*) INTO n FROM public.cards
   WHERE origin = 'manual' AND set_id IN ('bd', 'custom-bulbasaur-deck') AND set_name <> 'Bulbasaur Deck';
  IF n <> 0 THEN RAISE EXCEPTION '% manual bd cards are not "Bulbasaur Deck"', n; END IF;

  SELECT count(*) INTO n FROM public.cards
   WHERE origin = 'manual' AND set_id IN ('sd', 'custom-squirtle-deck') AND set_name <> 'Squirtle Deck';
  IF n <> 0 THEN RAISE EXCEPTION '% manual sd cards are not "Squirtle Deck"', n; END IF;
END $$;

INSERT INTO public.sets (id, name, origin) VALUES
  ('custom-bulbasaur-deck', 'Bulbasaur Deck', 'manual'),
  ('custom-squirtle-deck', 'Squirtle Deck', 'manual')
ON CONFLICT (id) DO NOTHING;

UPDATE public.cards SET set_id = 'custom-bulbasaur-deck'
 WHERE origin = 'manual' AND set_id = 'bd' AND set_name = 'Bulbasaur Deck';

UPDATE public.cards SET set_id = 'custom-squirtle-deck'
 WHERE origin = 'manual' AND set_id = 'sd' AND set_name = 'Squirtle Deck';

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.cards WHERE set_id = 'custom-bulbasaur-deck';
  IF n <> 8 THEN RAISE EXCEPTION 'custom-bulbasaur-deck has % cards, expected 8', n; END IF;

  SELECT count(*) INTO n FROM public.cards WHERE set_id = 'custom-squirtle-deck';
  IF n <> 5 THEN RAISE EXCEPTION 'custom-squirtle-deck has % cards, expected 5', n; END IF;

  SELECT count(*) INTO n FROM public.cards WHERE set_id IN ('bd', 'sd') AND origin <> 'ptcgdb';
  IF n <> 0 THEN RAISE EXCEPTION '% non-ptcgdb cards remain on bd/sd', n; END IF;

  SELECT count(*) INTO n FROM public.cards WHERE set_id = 'bd' AND origin = 'ptcgdb';
  IF n <> 10 THEN RAISE EXCEPTION 'bd has % ptcgdb cards, expected 10', n; END IF;

  SELECT count(*) INTO n FROM public.cards WHERE set_id = 'sd' AND origin = 'ptcgdb';
  IF n <> 127 THEN RAISE EXCEPTION 'sd has % ptcgdb cards, expected 127', n; END IF;

  SELECT count(*) INTO n FROM public.sets
   WHERE id IN ('custom-bulbasaur-deck', 'custom-squirtle-deck') AND origin = 'manual';
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 new custom sets, found %', n; END IF;
END $$;

SELECT public.refresh_explore_filter_options();

COMMIT;
