# Japanese (ptcgdb) and Pocket set names

**Status:** Planned (owner-approved direction 2026-09-27). Quick fix (display fallback) done; proper fix not started.

## Problem (read-only diagnosis, 2026-09-27)

- All 19,705 `ptcgdb` Japanese cards have `set_name` and `set_series` NULL. The source gives only a code (`raw_data.set_name` = `"SV9"`), so Card Detail showed no set (owner report on `ptcgdb-sv9-40`).
- All 2,480 Pocket cards (`tcgdex`, not Japanese) also have `set_name` NULL on the card, although their `sets` rows are named.
- TCGdex Japanese cards have a Japanese `set_name`, no series.
- Every card has a `set_id` and a matching `sets` row (checked 2026-09-27), so no card is truly set-less.
- `sets` has 285 `ptcgdb` rows named with the upper-cased code (`"SV4A"`), no series. The other 29 ptcgdb codes have no ptcgdb row because an English set owns the ID (`sv9` = English "Journey Together"; Japanese SV9 is バトルパートナーズ / "Battle Partners").
- `explore_filter_options` builds the TCG (JPN) Set list from `sets` by ID, so the Set filter shows codes for 285 sets and the **English** name for the 29 colliding ones.
- FilterPanel already groups series-less sets under **"Uncategorized"** (`seriesBucketKey`), so unnamed sets are reachable in the Set filter today.

## Owner question: store a placeholder like "Unknown set"?

No. Keep the set code as the identity and derive a label on screen.
- A shared placeholder merges different sets under one name in the filter, and code cannot tell a placeholder from a real name later.
- The push rewrites API rows; a stored placeholder would be overwritten or would need special cases.
- Series-less sets already sit under "Uncategorized". A label derived on screen is replaced as soon as a real name is published, with nothing to clean up.

## Quick fix (done in the working tree 2026-09-27)

`src/lib/cardSetLabel.js`: Card Detail shows the set name, or the upper-cased code when no name is recorded (`SV9 · #040`, no empty `()`); the header set chip appears for unnamed sets too and still filters by `set_id`. Test: `test:card-set-label` (3).

## Proper fix (next slice)

1. **Name source, reviewed and committed** (e.g. `scripts/data/japanese_set_names.json`: code → English name, Japanese name, series):
   - English: TCGCSV category 85 group names (`"SV9: Battle Partners"`) match 211 of 314 ptcgdb codes by code prefix/abbreviation = 14,966 of 19,705 cards (76%). Review short codes (`si`, `sd`, `ma`, `sa`…) for false matches.
   - Gaps (mostly split older sets: `bw1-bb`/`bw1-bw`, `xy1-bx`/`xy1-by`, `dpt*`): small manual table.
   - Japanese name fallback: TCGdex Japanese `sets` (111 of 314 codes, 10,755 cards).
   - Series from the code prefix (`sv` Scarlet & Violet, `s` Sword & Shield, `sm` Sun & Moon, `xy`, `bw`, `dp`/`dpt`, `l` LEGEND, `m` MEGA) — confirm the list.
2. **Publish:** `push_duckdb_to_supabase.py` fills `set_name`/`set_series` on ptcgdb cards and names the ptcgdb `sets` rows; Pocket cards get `set_name`/`set_series` from their `sets` rows. Changed payloads change fingerprints, so the first run rewrites ~22k rows once.
3. **The 29 colliding codes:** decide how to publish their sets without taking the English IDs (e.g. a `ja-` prefix like the Neo repair). `buildJpnCardKey(set_id, number)` pairs TCGdex and ptcgdb twins, so a set ID change must keep that pairing working (test it).
4. **Rarity codes:** ptcgdb rarities are raw codes (`rare_c_c`); map to readable names in the same pass if the owner wants.
5. **Rollout:** tests; `main` sync (owner OK) so the scheduled run applies it; refresh `explore_filter_options`; verify Card Detail, the JPN Set filter labels, and Uncategorized counts.
