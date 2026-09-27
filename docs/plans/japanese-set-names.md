# Japanese (ptcgdb) and Pocket set names

**Status:** Quick fix (display fallback) done and owner-verified 2026-09-27. Proper fix: name table + collision plan **owner-approved 2026-09-27** (decisions below); **step 2 done and deployed as v2 `6cef3cf`; step 3 SQL applied and verified 2026-09-27.** `main` sync done 2026-09-27 (`3c76d39`, owner-approved; Pages run `36349781875` success): the 2026-09-28 07:30 UTC Supabase run should relabel the 15 Pocket sets' series to "Pokémon TCG Pocket" and rewrite the 2,480 Pocket cards once with `set_name`/`set_series`. Open owner decisions: the 13 manual `bd`/`sd` cards (below), rarity codes (step 4), optional follow-ups (step 5).

## Owner decisions (2026-09-27)

1. **Names:** all 314 approved as drafted, including the 23 `manual` translations.
2. **Series:** Japan-tagged — `Japanese Diamond & Pearl`, `Japanese Platinum`, `Japanese HeartGold & SoulSilver`, `Japanese Black & White`, `Japanese XY`, `Japanese Sun & Moon`, `Japanese Sword & Shield`, `Japanese Scarlet & Violet`, `Japanese Mega Evolution` — so they stay separate from English groups when source is "All". Pocket `sets.series` `tcgp` → `Pokémon TCG Pocket`.
3. **Name format:** `{code}: {English name}` (TCGCSV style), e.g. `SV9: Battle Partners`; the code is ptcgdb's own casing (`raw_data.set_name`: `SV2a`, `DPt-EPd`, `XY6-B`). The promo names drop TCGCSV's own prefix first (`S-P: Sword & Shield Promos`, not `S-P: S-P: …`). Stored in the JSON as `name`, with `code_display` and `name_en`.
4. **Collisions:** 27 codes → `ja-{code}`; `xy6`/`xy7` fold into `xy6-b`/`xy7-b`.


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

## Name table (drafted and approved 2026-09-27)

`scripts/data/japanese_set_names.json` (full table view: `japanese-set-names-table.md`). Per code: published `set_id`, English `name`, `name_ja`, `series`, `release_date`, `source`, `cards`, `note`.

- **Identification:** each ptcgdb card's `raw_data.sources[].name` holds the official Japanese product name (e.g. `bb` → バトルスタートデッキ ブーバーン). Every code was named from that, not from its letters.
- **English names:** 291 of 314 codes (19,204 of 19,705 cards) equal a TCGCSV category 85 group name exactly (checked by script; `source: tcgcsv:<groupId>`, which also gives `release_date`). The other 23 codes (501 cards) are marked `manual`: split decks TCGCSV lists as one group (`bgst`/`bgsv`, `cs1*`, `hsz*`), the combined `dp4`/`dp5`, the BW Beginning Sets (`hs*`), `ma`, `mg`, `mps`, `mps08`, `pw`, `sa`, `sm-xy`.
- **Short-code traps found (why names were not matched by code):** `si` is Start Deck 100, not TCGCSV `SI` Southern Island (1999). `sc` is the 2013 BW Shiny Collection, not SwSh `sC`. `so` is TCGCSV `s0` (zero). `clk` is TCGCSV `CLV`. TCGCSV's `svAM`/`svAW` abbreviations do not line up with ptcgdb's `sval`/`svam`/`svaw`. `xy` is SM-era The Best of XY, and `bw` is the 2019 Extra Regulation Box. Two collision codes are not what their English ID suggests: `sma` = Sun & Moon Starter Set (English `sma` = Hidden Fates Shiny Vault) and `hsp` = BW Beginning Set Tepig deck (English `hsp` = HGSS promos).
- **Series:** English-series labels by release era, matching the English filter groups: Diamond & Pearl (DP), Platinum (DPt), HeartGold & SoulSilver (LEGEND), Black & White, XY, Sun & Moon, Sword & Shield, Scarlet & Violet, Mega Evolution. Products released later than the cards they reprint go by release (`bw` Extra Regulation Box and `xy` The Best of XY → Sun & Moon).
- **Japanese names:** from the official product name (pack name inside 「」), overridden for promo and multi-product codes. `sets` has no column for them yet; they stay in the JSON until the owner wants them shown.

## Collisions (29 codes; plan drafted 2026-09-27)

`bwp dp1 dp2 dp3 dp4 dp5 dpp hsp sm6 sm7 sm8 sm9 sm10 sm11 sm12 sma smp sv3 sv6 sv7 sv8 sv9 sv10 xy2 xy3 xy4 xy6 xy7 xyp` (3,545 cards) sit on English set IDs, so the JPN Set filter shows the English name, and an English set filter with source "All" also returns these Japanese cards.

- 27 codes → `ja-{code}` sets (`origin` ptcgdb), like the Neo repair. The English sets are untouched.
- `xy6` and `xy7` are only the secret rares (079–089, 082–092) of Emerald Break / Bandit Ring; fold them into `xy6-b` / `xy7-b` (no number overlap, checked) instead of a second "Emerald Break" entry.
- **Card IDs do not change** (`ptcgdb-sv9-40` stays), so annotations, history, queues, share links and the push's twin skip (`ptcgdb_twin_id`, by ID) are unaffected. No ptcgdb card has annotations or set overrides today (checked).
- **Twin matching:** `buildJpnCardKey` / `_build_jpn_card_key` strip a leading `ja-` so `ja-sm6` + `040` still keys as `sm6:40` (parity tests updated). Today 0 TCGdex/ptcgdb twins coexist (checked with normalized numbers), so this protects future rows; it also makes `ja-neo1` key as `neo1`, which has no ptcgdb twins.
- Existing overlap, not changed here: 46 codes also have a small TCGdex set row with the same code in another case (`SM6` 禁断の光, 8 cards, next to ptcgdb `sm6`). After naming, the filter shows e.g. "禁断の光" (TCGdex) and "Forbidden Light" (ptcgdb) as two entries. Merging them is a separate option (the push could publish those TCGdex cards under the ptcgdb set ID).

## Proper fix (next slice) — revised 2026-09-27

Finding: **ptcgdb is not in the weekly push.** `japanese_cards_ptcgdb` no longer exists in DuckDB and ptcgdb publishing is opt-in (`--include-ptcgdb`), so the 19,705 ptcgdb rows in Supabase change only by hand. The ptcgdb part is therefore a one-time data change; the push is changed only so a future `--include-ptcgdb` run agrees with it.

1. **Name table** — approved 2026-09-27 (above). `series` and `name` in the JSON already use the approved formats.
2. **Code (v2, tests):**
   - `jpnCardKey.js` + `jpn_card_key_utils.py`: strip a leading `ja-`; parity tests.
   - `push_duckdb_to_supabase.py`: `push_ptcgdb_sets` / `push_japanese_cards_ptcgdb` read the JSON (names, series, release dates, published set IDs, `set_name`/`set_series` on cards); `push_pocket_cards` fills `set_name`/`set_series` from `pocket_sets` (optionally series `tcgp` → "Pokémon TCG Pocket" in `push_sets`). The Pocket change reaches production through the scheduled run after a `main` sync (owner OK), and rewrites the 2,480 Pocket rows once (fingerprints change).
   - Migration file generated from the JSON (reviewable SQL): upsert 285 ptcgdb `sets` rows with names/series/release dates; insert 27 `ja-*` sets; move the 3,545 colliding cards to their published set ID (22 into `xy6-b`/`xy7-b`); set `set_name`/`set_series` on all ptcgdb cards from `sets`; refresh `explore_filter_options`. One transaction.
   - **Done 2026-09-27 (working tree):** twin key strips `ja-` (JS + Python, 7 shared parity vectors); `push_duckdb_to_supabase.py` `load_ptcgdb_set_names` / `ptcgdb_published_set` (unknown codes keep their ID, unnamed, with a `::warning::`), `push_ptcgdb_sets` / `push_japanese_cards_ptcgdb` publish the reviewed set ID, name, series, release date and card `set_name`/`set_series`; `pocket_series` (`tcgp` → "Pokémon TCG Pocket") in `push_sets` and Pocket cards get `set_name`/`set_series`. **Frontend:** `groupExploreSetsBySource` accepted only series `tcgp` as Pocket; it now accepts both labels, so **v2 must deploy before production's Pocket series changes** (otherwise Pocket sets fall into the JPN Set list). Generator `scripts/generate_ptcgdb_set_names_sql.py` → `supabase/migrations/20260927072333_ptcgdb_japanese_set_names.sql` (preconditions, 312-row set upsert guarded by `WHERE sets.origin = 'ptcgdb'`, 3,545-card move, 19,705 name fill, post-checks incl. per-set card counts, matview refresh; exact undo in its header, based on `lower(raw_data->>'set_name')` = original `set_id`, verified 0 mismatches). Tests: push 69 (7 new, incl. a drift test: committed SQL == generator output), parity both sides, `test:explore-set-options` 9; `npm run check:quick` exit 0. **Throwaway Postgres 18.2 run** on a production-shaped fixture (29 English sets with their production card counts, 285 ptcgdb sets, 19,705 ptcgdb cards per the JSON, FK `cards.set_id → sets.id`): first run 312 / 3,545 / 19,705, second run 0 / 0 (idempotent); English counts and names unchanged; `sv1a.card_count` kept; three failure cases (unknown code, `ja-sv9` owned by another origin, extra card) abort with nothing changed.
3. **Apply (owner-approved, production):** the migration as SQL via the Supabase MCP tool, then verify: ptcgdb cards with NULL `set_name` = 0; no ptcgdb card on an English set ID; the 29 English sets' card counts unchanged for their own origin; filter options show names; Card Detail on `ptcgdb-sv9-40` shows "Battle Partners".
- **Applied to production 2026-09-27 ~07:45 UTC (owner-approved)** via the Supabase MCP `execute_sql` tool (not `supabase db push`; not in the migration history table). All in-transaction checks passed. Verified read-only: 19,705 ptcgdb cards, 0 with NULL `set_name`/`set_series`, 0 on another origin's set; 27 `ja-*` sets; md5 of the 312 ptcgdb set rows (`id|name|series|release_date`) = `464037a01d748718a62f97ed3643a003` = the same digest computed from the JSON (no transcription drift); the 29 English sets' own card counts equal the baseline; `ptcgdb-sv9-40` → `ja-sv9`, "SV9: Battle Partners", "Japanese Scarlet & Violet", number `040`; `xy6-b` 89 cards; `sv1a.card_count` untouched. `explore_filter_options` JPN: 391 sets (393 − 29 English IDs + 27 `ja-*`), 312 under "Japanese …" series, `SM6` 禁断の光 (TCGdex) beside `ja-sm6` "SM6: Forbidden Light" as expected.
- **Found, not changed (owner decision):** 13 manual "Japan Exclusive" cards (2026-05-13; `custom-bd-*` "Bulbasaur Deck" ×8, `custom-sd-*` "Squirtle Deck" ×5) use set IDs `bd`/`sd`, which are unrelated ptcgdb products. Their Card Detail keeps their own `set_name`, but the TCG/Custom Set filters now label those sets "Bd: Battle Starter Deck (Torterra)" / "SD: V Starter Decks" under "Japanese …" series (before: bare "BD"/"SD", Uncategorized). **Owner decision 2026-09-27:** move them to new custom sets `custom-bulbasaur-deck` / `custom-squirtle-deck` (no series; `cd` Chikorita Deck and `td` Totodile Deck unchanged). Root cause: the Add Card form derived Set IDs from initials and `ensureManualSetRow` ignores an existing row. Working tree: `src/lib/customSetId.js` (reuse a custom set by name; never derive an ID a differently named set owns, fall back to `custom-{slug}`), `fetchSetDirectory`, form shows the Set ID under Set Name with an amber warning on a taken ID; test `test:custom-set-id` (8); migration `20260927212613_manual_bulbasaur_squirtle_deck_sets.sql` (not applied; tested on throwaway Postgres: 8+5 moved, re-run 0, mismatch aborts). Order: deploy the form first, then apply. Also 4 manual `xyp` Japan Exclusive cards look like duplicate pairs (`custom-xyp-JP279`/`xyp-JP279`, `…JP289`).
4. **Rarity codes:** ptcgdb rarities are raw codes (`rare_c_c`); separate, if the owner wants.
5. **Optional follow-ups:** show the Japanese name (needs a column); merge the 46 duplicate TCGdex/ptcgdb set entries; series for TCGdex Japanese sets from the same table.
