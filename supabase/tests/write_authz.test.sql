-- 2B/2D write-authorization tests. Run by run_write_authz_tests.sh:
--   psql -v phase=before  -> documents the production holes (fixture only)
--   psql -v phase=after   -> after the timestamped 2B and 2D migrations
-- Each probe runs as a JWT identity and is rolled back (see write_authz_lib.sql).
-- A = ...0a and B = ...0b are signed-in collaborators; 'anon-jwt' is an
-- anonymous Supabase session; 'signed-out' is the anon role; 'service' is
-- service_role (ingest).

\set ON_ERROR_STOP 1

TRUNCATE public._results;

-- Shorthand: expected value per phase.
CREATE OR REPLACE FUNCTION pg_temp.w(p_before text, p_after text) RETURNS text
LANGUAGE sql AS $$ SELECT CASE WHEN current_setting('test.phase') = 'before' THEN p_before ELSE p_after END $$;
SELECT set_config('test.phase', :'phase', false) \gset
\o /dev/null

-- ============================================================
-- 2B: cards
-- ============================================================
SELECT _expect('2B-01 A PATCHes an API card name',
  _probe('a', $$UPDATE cards SET name = 'Hacked' WHERE id = 'sv1-1'$$),
  pg_temp.w('ok:1', 'err:42501:permission denied%'));

SELECT _expect('2B-02 A DELETEs a pokemontcg.io card (cascades its annotation)',
  _probe('a', $$DELETE FROM cards WHERE id = 'sv1-1'$$,
         $$NOT EXISTS (SELECT 1 FROM annotations WHERE card_id = 'sv1-1')$$),
  pg_temp.w('ok:1:true', 'ok:0:false'));

SELECT _expect('2B-03 A DELETEs a tcgdex card',
  _probe('a', $$DELETE FROM cards WHERE id = 'A1-001'$$),
  pg_temp.w('ok:1', 'ok:0'));

SELECT _expect('2B-04 A INSERTs an API-origin card',
  _probe('a', $$INSERT INTO cards (id, name, set_id, origin, created_by)
               VALUES ('sv1-999', 'Fake', 'sv1', 'pokemontcg.io', '00000000-0000-0000-0000-00000000000a')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2B-05 A INSERTs a manual card credited to B',
  _probe('a', $$INSERT INTO cards (id, name, set_id, origin, created_by)
               VALUES ('custom-deck-9', 'Mine', 'custom-deck', 'manual', '00000000-0000-0000-0000-00000000000b')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2B-06 A INSERTs a manual card as herself (app path)',
  _probe('a', $$INSERT INTO cards (id, name, set_id, origin, origin_detail, format, created_by)
               VALUES ('custom-deck-9', 'Mine', 'custom-deck', 'manual', 'TCG', 'printed', '00000000-0000-0000-0000-00000000000a')$$),
  'ok:1');

SELECT _expect('2B-07 A INSERTs a manual card carrying an ingest fingerprint',
  _probe('a', $$INSERT INTO cards (id, name, set_id, origin, created_by, api_hash)
               VALUES ('custom-deck-9', 'Mine', 'custom-deck', 'manual', '00000000-0000-0000-0000-00000000000a', 'x')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2B-08 A DELETEs her own manual card',
  _probe('a', $$DELETE FROM cards WHERE id = 'custom-deck-2'$$), 'ok:1');

-- Option A (drafted): collaborators manage every manual card.
SELECT _expect('2B-09 A DELETEs B''s manual card (Option A: allowed)',
  _probe('a', $$DELETE FROM cards WHERE id = 'custom-deck-3'$$), 'ok:1');

SELECT _expect('2B-10 A DELETEs a legacy manual card with no creator (Option A: allowed)',
  _probe('a', $$DELETE FROM cards WHERE id = 'custom-deck-1'$$), 'ok:1');

SELECT _expect('2B-11 A PATCHes a manual card name directly (bypasses history)',
  _probe('a', $$UPDATE cards SET name = 'Direct' WHERE id = 'custom-deck-2'$$),
  pg_temp.w('ok:1', 'err:42501:permission denied%'));

SELECT _expect('2B-12 A renames a manual card through the RPC (history row by A)',
  _probe('a', $$SELECT * FROM rename_manual_card_with_history('custom-deck-3', 'Renamed')$$,
         $$(SELECT name FROM cards WHERE id = 'custom-deck-3') = 'Renamed'
           AND EXISTS (SELECT 1 FROM edit_history WHERE card_id = 'custom-deck-3'
                       AND field_name = 'card_name' AND edited_by = '00000000-0000-0000-0000-00000000000a')$$),
  'ok:1:true');

SELECT _expect('2B-13 A renames an API card through the RPC',
  _probe('a', $$SELECT * FROM rename_manual_card_with_history('sv1-1', 'Renamed')$$),
  'err:P0001:Only manual/custom cards can be renamed.');

SELECT _expect('2B-14 anonymous JWT INSERTs a manual card',
  _probe('anon-jwt', $$INSERT INTO cards (id, name, set_id, origin, created_by)
                      VALUES ('custom-deck-9', 'Anon', 'custom-deck', 'manual', '00000000-0000-0000-0000-00000000000f')$$),
  'err:42501:new row violates row-level security%');

SELECT _expect('2B-15 anonymous JWT DELETEs a manual card',
  _probe('anon-jwt', $$DELETE FROM cards WHERE id = 'custom-deck-1'$$), 'ok:0');

SELECT _expect('2B-16 signed-out INSERTs a manual card',
  _probe('signed-out', $$INSERT INTO cards (id, name, set_id, origin)
                        VALUES ('custom-deck-9', 'Anon', 'custom-deck', 'manual')$$),
  pg_temp.w('err:42501:new row violates row-level security%', 'err:42501:permission denied%'));

SELECT _expect('2B-17 signed-out calls the rename RPC',
  _probe('signed-out', $$SELECT * FROM rename_manual_card_with_history('custom-deck-1', 'X')$$),
  pg_temp.w('err:P0001:Sign in required%', 'err:42501:permission denied for function%'));

-- ============================================================
-- 2B: sets
-- ============================================================
SELECT _expect('2B-18 A PATCHes an API set name',
  _probe('a', $$UPDATE sets SET name = 'Hacked' WHERE id = 'sv1'$$),
  pg_temp.w('ok:1', 'err:42501:permission denied%'));

SELECT _expect('2B-19 A INSERTs a set labelled tcgdex',
  _probe('a', $$INSERT INTO sets (id, name, origin) VALUES ('B9', 'Fake', 'tcgdex')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2B-20 A INSERTs a manual set (app path)',
  _probe('a', $$INSERT INTO sets (id, name, origin) VALUES ('custom-new', 'New', 'manual')$$),
  'ok:1');

-- ============================================================
-- 2B: ingest (service_role) keeps full access
-- ============================================================
SELECT _expect('2B-21 service_role updates an API card',
  _probe('service', $$UPDATE cards SET name = 'Pineco', api_hash = 'h9', last_seen_in_api = now() WHERE id = 'sv1-1'$$),
  'ok:1');

SELECT _expect('2B-22 service_role upserts an API card and set',
  _probe('service', $$WITH s AS (INSERT INTO sets (id, name, origin) VALUES ('sv2', 'Paldea Evolved', 'pokemontcg.io')
                               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id)
                    INSERT INTO cards (id, name, set_id, origin, api_hash)
                    SELECT 'sv2-1', 'Sprigatito', id, 'pokemontcg.io', 'h' FROM s$$),
  'ok:1');

SELECT _expect('2B-23 service_role deletes an API card',
  _probe('service', $$DELETE FROM cards WHERE id = 'A1-001'$$), 'ok:1');

-- ============================================================
-- 2D: apply_annotation_with_history
-- ============================================================
-- sv1-1 annotation is seeded at version 3, updated_by A.
SELECT _expect('2D-01 A saves with a forged updated_by (B) and updated_at (2000)',
  _probe('a', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":4,
             "updated_by":"00000000-0000-0000-0000-00000000000b","updated_at":"2000-01-01T00:00:00Z"}',
           '[{"field_name":"notes","old_value":"seed","new_value":"x"}]')$$,
         $$(SELECT updated_by = '00000000-0000-0000-0000-00000000000a' AND updated_at = now() AND version = 4
            FROM annotations WHERE card_id = 'sv1-1')$$),
  pg_temp.w('ok:1:false', 'ok:1:true'));

SELECT _expect('2D-02 A saves with a forged jump to version 99',
  _probe('a', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":99}', '[]')$$,
         $$(SELECT version = 99 FROM annotations WHERE card_id = 'sv1-1')$$),
  pg_temp.w('ok:1:true', 'err:22023:ANNOTATION_VERSION_INVALID%'));

SELECT _expect('2D-03 A saves with a decreasing version (1)',
  _probe('a', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":1}', '[]')$$,
         $$(SELECT version = 1 FROM annotations WHERE card_id = 'sv1-1')$$),
  pg_temp.w('ok:1:true', 'err:22023:ANNOTATION_VERSION_INVALID%'));

SELECT _expect('2D-04 stale expected version still raises the P0001 conflict',
  _probe('a', $$SELECT apply_annotation_with_history(false, 2,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":3}', '[]')$$),
  'err:P0001:ANNOTATION_VERSION_CONFLICT%');

SELECT _expect('2D-05 A files history under B''s batch run',
  _probe('a', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":4}',
           '[{"field_name":"notes","old_value":"seed","new_value":"x"}]',
           '11111111-1111-1111-1111-11111111111b')$$),
  pg_temp.w('ok:1', 'err:42501:BATCH_RUN_NOT_OWNED%'));

SELECT _expect('2D-06 A files history under her own batch run (Batch path)',
  _probe('a', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":4}',
           '[{"field_name":"notes","old_value":"seed","new_value":"x"}]',
           '11111111-1111-1111-1111-11111111111a')$$,
         $$EXISTS (SELECT 1 FROM edit_history WHERE card_id = 'sv1-1' AND edited_by = '00000000-0000-0000-0000-00000000000a'
                   AND batch_run_id = '11111111-1111-1111-1111-11111111111a' AND edited_at = now())$$),
  'ok:1:true');

SELECT _expect('2D-07 A inserts a new annotation at version 5',
  _probe('a', $$SELECT apply_annotation_with_history(true, NULL,
           '{"card_id":"custom-deck-1","notes":"x","extra":{},"overrides":{},"version":5}', '[]')$$),
  pg_temp.w('ok:1', 'err:22023:ANNOTATION_VERSION_INVALID%'));

SELECT _expect('2D-08 A inserts a new annotation (app path) crediting B',
  _probe('a', $$SELECT apply_annotation_with_history(true, NULL,
           '{"card_id":"custom-deck-1","notes":"x","extra":{},"overrides":{},"version":1,
             "updated_by":"00000000-0000-0000-0000-00000000000b"}',
           '[{"field_name":"notes","old_value":null,"new_value":"x"}]')$$,
         $$(SELECT updated_by = '00000000-0000-0000-0000-00000000000a' AND version = 1 FROM annotations WHERE card_id = 'custom-deck-1')$$),
  pg_temp.w('ok:1:false', 'ok:1:true'));

SELECT _expect('2D-09 anonymous JWT saves through the RPC',
  _probe('anon-jwt', $$SELECT apply_annotation_with_history(false, 3,
           '{"card_id":"sv1-1","notes":"x","extra":{},"overrides":{},"version":4}', '[]')$$),
  pg_temp.w('err:P0001:ANNOTATION_VERSION_CONFLICT%', 'err:42501:Sign in required%'));

-- ============================================================
-- 2D: direct PostgREST writes
-- ============================================================
SELECT _expect('2D-10 A PATCHes an annotation directly, crediting B',
  _probe('a', $$UPDATE annotations SET notes = 'y', version = 4,
               updated_by = '00000000-0000-0000-0000-00000000000b' WHERE card_id = 'sv1-1'$$,
         $$(SELECT updated_by = '00000000-0000-0000-0000-00000000000a' FROM annotations WHERE card_id = 'sv1-1')$$),
  pg_temp.w('ok:1:false', 'ok:1:true'));

SELECT _expect('2D-11 A PATCHes an annotation without bumping the version',
  _probe('a', $$UPDATE annotations SET notes = 'y' WHERE card_id = 'sv1-1'$$),
  pg_temp.w('ok:1', 'err:22023:ANNOTATION_VERSION_INVALID%'));

SELECT _expect('2D-12 A DELETEs an annotation directly',
  _probe('a', $$DELETE FROM annotations WHERE card_id = 'sv1-1'$$),
  pg_temp.w('ok:1', 'err:42501:permission denied%'));

SELECT _expect('2D-13 A INSERTs an annotation directly (app path: addCustomCard)',
  _probe('a', $$INSERT INTO annotations (card_id, notes, extra, version, updated_by)
               VALUES ('custom-deck-1', 'n', '{}', 1, '00000000-0000-0000-0000-00000000000a')$$,
         $$(SELECT updated_by = '00000000-0000-0000-0000-00000000000a' AND version = 1 FROM annotations WHERE card_id = 'custom-deck-1')$$),
  'ok:1:true');

SELECT _expect('2D-14 A INSERTs history credited to B',
  _probe('a', $$INSERT INTO edit_history (card_id, field_name, new_value, edited_by)
               VALUES ('sv1-1', 'notes', 'x', '00000000-0000-0000-0000-00000000000b')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2D-15 A INSERTs backdated history',
  _probe('a', $$INSERT INTO edit_history (card_id, field_name, new_value, edited_by, edited_at)
               VALUES ('sv1-1', 'notes', 'x', '00000000-0000-0000-0000-00000000000a', '2026-02-01+00')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2D-16 A INSERTs history under B''s batch run',
  _probe('a', $$INSERT INTO edit_history (card_id, field_name, new_value, edited_by, batch_run_id)
               VALUES ('sv1-1', 'notes', 'x', '00000000-0000-0000-0000-00000000000a',
                       '11111111-1111-1111-1111-11111111111b')$$),
  pg_temp.w('ok:1', 'err:42501:new row violates row-level security%'));

SELECT _expect('2D-17 A INSERTs honest history directly',
  _probe('a', $$INSERT INTO edit_history (card_id, field_name, new_value, edited_by)
               VALUES ('sv1-1', 'notes', 'x', '00000000-0000-0000-0000-00000000000a')$$),
  'ok:1');

SELECT _expect('2D-18 A TRUNCATEs edit_history (RLS does not cover TRUNCATE)',
  _probe('a', $$TRUNCATE edit_history$$),
  pg_temp.w('ok:0', 'err:42501:permission denied%'));

SELECT _expect('2D-19 Data Health cleanup RPC still works and credits the caller',
  _probe('b', $$SELECT * FROM apply_annotation_value_cleanup('art_style', 'Watercolor', 'Watercolour', 'replace')$$,
         $$(SELECT version = 4 AND updated_by = '00000000-0000-0000-0000-00000000000b' AND art_style = '["Watercolour", "Sketch"]'::jsonb
            FROM annotations WHERE card_id = 'sv1-1')$$),
  'ok:1:true');

SELECT _expect('2D-20 service_role writes explicit audit values (migration scripts)',
  _probe('service', $$UPDATE annotations SET version = 50, updated_by = '00000000-0000-0000-0000-00000000000b',
                     updated_at = '2020-01-01+00' WHERE card_id = 'sv1-1'$$,
         $$(SELECT version = 50 AND updated_by = '00000000-0000-0000-0000-00000000000b' FROM annotations WHERE card_id = 'sv1-1')$$),
  'ok:1:true');

SELECT _expect('2D-21 deleting a manual card still cascades its annotation',
  _probe('a', $$DELETE FROM cards WHERE id = 'custom-deck-4'$$,
         $$NOT EXISTS (SELECT 1 FROM annotations WHERE card_id = 'custom-deck-4')$$),
  'ok:1:true');

\o
-- ============================================================
-- Report
-- ============================================================
\echo
\echo === phase :phase ===
SELECT label, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result,
       CASE WHEN pass THEN left(got, 60) ELSE got || '  (want ' || want || ')' END AS detail
FROM public._results ORDER BY seq;

DO $$
DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM public._results WHERE NOT pass;
  IF f > 0 THEN
    RAISE EXCEPTION '% of % write-authz probes failed', f, (SELECT count(*) FROM public._results);
  END IF;
END $$;
