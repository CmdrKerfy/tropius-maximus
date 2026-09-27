# Agent Handoff Log

Use this file at every clean break so another agent can continue immediately if usage limits are hit.

## Required preflight before next phase or major edit

Before starting the next phase of any plan (or any major edit/refactor/migration), the agent must send this preflight to the owner and wait for acceptance:

1. **Model check (Auto mode):** state the exact model in use and ask for acceptance.
2. **Token feasibility:** state whether the requested work is likely completable within remaining token limits.
3. **Proceed prompt:** ask whether to continue with full scope or a scoped slice.

If token feasibility is **unlikely**, the agent must propose:
- a scoped slice that fits the remaining budget, and
- the clean-break handoff point it will leave in this file.

## How to update (required at clean breaks)

1. Add a new dated entry at the top.
2. Keep it short, concrete, and executable.
3. Reference exact files, migrations, and commands where relevant.
4. Include one explicit "Next action" that can be started without extra context.

---

## Entry Template

### YYYY-MM-DD HH:MM (local) - Agent/session label

- Preflight sent and accepted:
  - Model accepted: yes/no
  - Token-feasibility declared: likely/unlikely
  - Scope selected: full/scoped
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/<active-plan>.md`
- Scope in this slice:
  - ...
- Completed:
  - ...
- Validation run:
  - `npm run check:quick` (pass/fail)
  - Any manual QA:
- Migrations touched:
  - `supabase/migrations/<id>_<name>.sql` (applied/not applied)
- Open risks or assumptions:
  - ...
- Next action (single first step):
  - ...

---

### 2026-09-27 (local) - Manual Bulbasaur/Squirtle Deck sets + Add Card Set ID guard

- Owner decisions: move the 13 manual `bd`/`sd` cards to `custom-bulbasaur-deck` / `custom-squirtle-deck`; no series; keep `cd`/`td`; add a form guard.
- Root cause: `CustomCardForm` derived Set IDs from initials; `ensureManualSetRow` ignores an existing set row (23505), so the cards joined PTCG-db's `bd`/`sd`.
- Working tree: `src/lib/customSetId.js` + test (8), `fetchSetDirectory` (adapter, paged; `db.js` returns [] for DuckDB), form derives via `resolveCustomSetId` and shows `SetIdNote` under Set Name (Set ID, existing/new, amber warning when another set owns it); migration `supabase/migrations/20260927212613_manual_bulbasaur_squirtle_deck_sets.sql` (not applied).
- Validation: `npm run check:quick` exit 0; Playwright smoke 2/2; migration on throwaway Postgres 18.2: 8+5 moved, second run 0, mismatch case aborts.
- **Done 2026-09-27 (owner-approved):** form fix deployed as v2 `78e679a` (Vercel success; live `CustomCardForm` chunk has the Set ID note); SQL applied via the Supabase MCP tool (~21:35 UTC; not in migration history). Verified: `custom-bulbasaur-deck` 8, `custom-squirtle-deck` 5 (13 annotations kept), `bd` 10 / `sd` 127 ptcgdb only; filter lists "Bulbasaur Deck"/"Squirtle Deck" under TCG and Custom, `bd`/`sd` only under JPN; 0 "Japanese …" series sets left in the TCG list.
- Next action: owner tries Add Card with Set Name "Bulbasaur Deck" (expect `custom-bulbasaur-deck · existing custom set`; no need to save) and "Charmander Deck" (expect `custom-charmander-deck · new set`). Then the 2026-09-28 scheduled-run review (after 07:30 UTC).

### 2026-09-27 (local) - Japanese set names: proper fix step 2 (code + SQL, not applied)

- Preflight: model Claude Opus 5.5; tokens ample; full scope. HEAD `50fa646` = origin/v2; remote `main` `81ff841`. 2026-09-28 scheduled runs not yet due (checked 07:17 UTC 2026-09-27), so their review is still pending.
- Completed (working tree, uncommitted): twin key strips `ja-` (JS + Python + parity vectors); push reads `scripts/data/japanese_set_names.json` for ptcgdb sets/cards; Pocket cards get `set_name`/`set_series`, Pocket series published as "Pokémon TCG Pocket"; `groupExploreSetsBySource` accepts both Pocket labels; generator `scripts/generate_ptcgdb_set_names_sql.py` and generated `supabase/migrations/20260927072333_ptcgdb_japanese_set_names.sql`. Details: `docs/plans/japanese-set-names.md` step 2.
- Production read-only checks: 19,705 ptcgdb cards / 314 codes / 285 ptcgdb sets; only `ja-neo1..4` (tcgdex) exist among `ja-*`; Pocket series `tcgp`, 2,480 Pocket cards with NULL `set_name`; no triggers on `cards`; FK `cards.set_id → sets.id`; 0 ptcgdb annotations; ptcgdb `api_hash` all NULL; `lower(raw_data->>'set_name')` = `set_id` for all ptcgdb cards (undo key). English own-origin card counts (baseline for post-apply check): bwp 101, dp1 130, dp2 124, dp3 132, dp4 106, dp5 100, dpp 56, hsp 25, sm6 150, sm7 187, sm8 240, sm9 198, sm10 238, sm11 261, sm12 272, sma 94, smp 251, sv3 230, sv6 226, sv7 175, sv8 252, sv9 190, sv10 244, xy2 110, xy3 114, xy4 124, xy6 112, xy7 101, xyp 216.
- Validation: `npm run check:quick` exit 0 (push 69, ingest 17, parity OK); SQL run twice on throwaway Postgres 18.2 (312/3,545/19,705 then 0/0) + 3 rollback cases.
- Migrations touched: `20260927072333_ptcgdb_japanese_set_names.sql` (new, **not applied**).
- Open risks: Pocket series change reaches production only after the v2 deploy (frontend must accept the label first) and a `main` sync; the drift test skips where the migration file is absent (`main`).
- Owner-approved: committed + pushed as v2 `6cef3cf` (Vercel success; home 200; live `mergeExploreFilterOptions` chunk accepts both Pocket labels).
- Owner-approved: SQL applied via the Supabase MCP tool (~07:45 UTC; not in migration history). Verified: 0 NULL names, 0 on other-origin sets, 27 `ja-*`, set-row md5 matches the JSON, English baseline counts unchanged, `ptcgdb-sv9-40` correct, JPN filter 391 sets. Found (not changed): 13 manual `bd`/`sd` "Bulbasaur/Squirtle Deck" cards share ptcgdb set IDs; 2 duplicate-looking manual `xyp` pairs.
- Owner-approved `main` sync: `3c76d39` (`81ff841..3c76d39`; 3 files from `6cef3cf`), tested in a temporary `main` worktree (push 69 OK, 1 skipped by design; ingest OK; parity OK; dry run on local DuckDB OK). Pages run `36349781875` success.
- Next action: after 2026-09-28 07:30 UTC, review the scheduled runs read-only: no collisions; refresh/ANALYZE OK; `ensure_edit_history_partitions` created nothing; ~355 changed TCGdex Japanese + ~2,480 changed Pocket cards; 0 TCGdex Japanese images on `assets.tcgdex.net/en/`; Pocket sets' series "Pokémon TCG Pocket" and 0 Pocket cards with NULL `set_name`; Pages 06:00 UTC run OK. Owner: visual check of Card Detail `ptcgdb-sv9-40` and the TCG (JPN) Set filter; decide on the 13 manual `bd`/`sd` cards.

### 2026-09-27 (local) - Japanese set names: name table + collision plan (read-only)

- Preflight: model Claude Opus 5.5; tokens ample; full scope (research + table; no code/production change). HEAD `50fa646` = origin/v2; remote `main` `81ff841`. 2026-09-28 scheduled runs not yet due (checked 06:55 UTC 2026-09-27).
- Owner: Card Detail quick check on `ptcgdb-sv9-40` passed (set codes show in Card Detail and the filter).
- Completed (read-only Supabase + TCGCSV):
  - `scripts/data/japanese_set_names.json` (new, uncommitted): 314 ptcgdb codes → published set ID, English name, Japanese name, series, release date, source, card count, note. Identified from `raw_data.sources[].name` (official product name). 291 codes / 19,204 cards equal a TCGCSV category 85 group name exactly; 23 codes / 501 cards `manual`. Review view: `docs/plans/japanese-set-names-table.md`.
  - Findings: ptcgdb is not in the weekly push (one-time data change needed); short-code traps (`si`, `sc`, `so`, `clk`, `svA*`, `sma`, `hsp`, `xy`, `bw`); `xy6`/`xy7` are secret-rare splits of `xy6-b`/`xy7-b`; 0 ptcgdb annotations; 0 coexisting TCGdex/ptcgdb twins.
  - Plan in `docs/plans/japanese-set-names.md` (Name table, Collisions, revised Proper fix).
- Validation: none needed (no code changed). Builder script kept in the session scratchpad only (inputs were SQL exports); the JSON is the source of truth.
- Migrations touched: none. No production writes.
- Owner decisions (same session): names approved as drafted; series "Japanese <era>" (Pocket `tcgp` → "Pokémon TCG Pocket"); published name "{code}: {English name}"; `ja-` for 27 codes + fold `xy6`/`xy7` into `xy6-b`/`xy7-b`. The JSON was updated to these formats (`name`, `code_display`, `name_en`, `series`); table view regenerated. Japanese names are not shown yet (no column).
- Next action: implement step 2 of "Proper fix" in `docs/plans/japanese-set-names.md` (twin key `ja-` strip + parity tests, push reads the JSON, Pocket set names, generated migration SQL), run tests, then ask before applying the SQL.

### 2026-09-26 (local) - 4D security slice; Card Detail closed; TCGCSV/Scrap research

- Preflight: model Claude Opus 5.5; tokens ample; full scope. HEAD `dedb7b5` = origin/v2; remote `main` `94da8f1`. 2026-09-28 scheduled runs not yet due (checked 02:41 UTC 2026-09-27).
- Owner: Card Detail re-test passed; closed, with troubleshooting steps recorded under 4C "Stale-tab Card Detail fix" because it has recurred. Share-preview test result not reported (prompt placeholder left).
- Completed:
  - 4D security slice (working tree): `react-router-dom` ^7.18.4, `@supabase/supabase-js` ^2.117.2, lockfile-only `npm audit fix` (vite 7.3.6, rollup, postcss, …). `npm audit` 0 (was 3 high prod + 8 dev). Main chunk gzip 183.2 → 194.8 kB (supabase-js +7.9, router +0.7, tooling rest; measured in a temp worktree, removed).
  - Read-only TCGCSV report (categories 3 and 85, all 679 groups) and a Pokémon Scrap design checklist: `docs/plans/card-adjacent-items-tcgcsv-and-scrap.md`. Read-only Supabase checks: no sealed items or Scrap cards in `cards` (8 "scrap" hits are all "Tool Scrapper"); Japan Exclusive manual precedent and image hosts recorded.
- Validation: `npm run check` exit 0 twice (after the bump and after the audit fix; smoke 2/2).
- Migrations touched: none. No production writes.
- Open risks: bundle +11.6 kB gzip (optional revert of supabase-js to 2.101.1 saves ~8 kB; `ws` is fixed either way); React Router 7.14 → 7.18 is only exercised by local smoke until a hosted check.
- Owner-approved: committed and pushed as v2 `e774ac5`; Vercel status success. Unauthenticated live check: home 200; `/share/card/P-A-054` (WhatsApp UA) `og:image` still `…/P-A/054/high.jpg`.
- Owner report: Japanese Neo share cards show the wrong (English) card image. Diagnosed read-only: ingest's English-asset fallback; 355 TCGdex Japanese cards affected (details under "Exact next action", "Wrong images on Japanese cards"). Fix in the working tree (ingest + push guard + 4 tests; push 62 OK, ingest 17 OK). Owner-approved: committed v2 `48bde08`; `main` sync `81ff841` (tested in a temp worktree; Pages run `36291158878` success). Optional immediate Supabase image clear: owner approved; backup verified read-only (355 rows, every URL matches the rule `/en/neo/{set}/{int n}/high.webp` or `/en/sm/{set}/{n}/high.webp`, ID-list md5 `a09d718ab20f300a13211c5d8ed6818b`, no triggers on `cards`), but the agent's UPDATE was **blocked by a Claude Code permission rule; not applied**. **Owner ran the UPDATE manually 2026-09-27; verified read-only:** 0 TCGdex Japanese cards with an `/en/` image (was 355); all 323 `ja-neo*` and the 51 SM rows have no image; 151 real `ja/` images untouched; English `neo4` images intact (113). Live share `og:image` for `ja-neo4-034`, `ja-neo4-014`, `SM6-103` is the placeholder.
- Owner request: Explore "Has Image" filter (All / Yes / No). Working tree (not in the docs commit): `applyHasImageFilter` in `appAdapter.js` (grid query and count-only path), `has_image` in `exploreUrlState.js` defaults, FilterPanel select (Supabase backend only; DuckDB mode hides it), active chip, reset; new `test:explore-url-state` (2). `npm run check` exit 0. Card-level check is accurate: 0 cards get a picture only from `annotations.image_override`; image_small/image_large are always both set or both null. No-image cards: 4,338 (tcgdex Japanese 4,179, Pocket 159). Speed (postgres, cached): Yes page 11 ms; No count on Source=All 2.9 s and No page at offset 2000 1.5 s (seq scan). Optional later: partial index `(name, id) WHERE image_small IS NULL AND image_large IS NULL` (~4.3k rows) if No feels slow.
- Owner-approved: Has Image filter committed and pushed as v2 `7eafda2` (docs `ad3ffc9` before it); Vercel status success, home 200.
- Owner request: Has Image must count user image overrides. Working tree: migration `20260927040251_explore_has_image_filter.sql` (computed field `card_has_image_override(cards)`, SECURITY INVOKER, anon revoked; partial index `idx_cards_no_image`) and `applyHasImageFilter` using it; new `test:has-image-filter` (3). Tested on throwaway Postgres 18.2 + **PostgREST 14.5** (production's version, from `pg_stat_activity`): the computed field works inside `or=(...)`; Yes 54,889 + No 4,337 = 59,226; override-only card = Yes, blank override = No; combined with a Source `or=`; anon denied; re-run idempotent; No count 25 ms and No page (offset 2000) 32 ms via the index, Yes page 0.2 ms. Production baseline (postgres, cached): No count 2.9-5.3 s, Yes count 4.6 s (unchanged by this; still a seq scan). `npm run check` exit 0. **Order: apply the migration before deploying the app change** (otherwise PostgREST rejects the unknown column).
- Owner-approved: migration applied as SQL via the Supabase MCP tool (~04:15 UTC 2026-09-27; not in the migration history table). Verified read-only: index exists (224 kB); function ACL `{postgres,authenticated,service_role}` (anon false); No 4,338 + Yes 54,888 = 59,226; No count uses `idx_cards_no_image`, 523 ms (was 2.9-5.3 s; the rest is one non-inlined function call per no-image row). App change deployed as v2 `39db96d` (owner-approved; Vercel success, home 200). Owner test: Has Image = No lists a blank Japanese Neo card; paste an image override in Card Detail; after refresh it shows under Yes, not No.
- **Owner test failed 2026-09-27 06:32 UTC:** Source = TCG (JPN) + Has Image = Yes → "canceling statement due to statement timeout" (API logs: page GET 8.7 s and count HEAD 11.4 s, 57014). Diagnosis (read-only, postgres, cached): (a) the JPN name-sorted page walks `idx_cards_name` past every English card (6.4k rows, 0.9 s without the filter) and, with Yes, also past the imageless Japanese cards that sort first (18.9k rows, 6.7 s); (b) the JPN Yes count reads 24k heap rows for the image columns (4.2 s). The override function is not the cost. Fix in working tree: app counts Yes as total − No (53 ms + 153 ms, both index-backed); migration `20260927063606_cards_japanese_name_index.sql` adds `idx_cards_japanese_name (name, id) WHERE origin_detail = 'japanese'` (page 1 reads 259 rows instead of ~19k; local test picks the index for the app's exact filter). `npm run check` exit 0. Owner-approved: index applied as SQL via the Supabase MCP tool (before 06:40 UTC 2026-09-27; not in the migration history table); verified: 1272 kB, JPN + Yes page 1 uses it, 168 ms (was 6.7 s). Count fix not yet deployed. Known gap: Batch "select all matching" (`fetchFirstNMatchingCardIds`) still uses an exact count on the grid query, so JPN + Yes there may time out.
- Count fix deployed as v2 `e461809` (Vercel success). **Owner re-test passed**; API logs since 06:34 UTC: 8 image-filter requests, all 200/206, max 3.9 s, no 57014.
- New owner report (read-only diagnosis, nothing changed): Card Detail shows no set info for ptcgdb Japanese cards (e.g. `ptcgdb-sv9-40`). All 19,705 ptcgdb cards have `set_name`/`set_series` NULL; `raw_data.set_name` is only the code ("SV9"). 29 of 314 ptcgdb set IDs equal an English set ID (`sv9` = English "Journey Together"; Japanese SV9 is バトルパートナーズ), so a `sets` lookup by ID would show the wrong set. TCGdex Japanese sets match 111 of 314 codes case-insensitively (10,755 cards, 55%); the rest are mostly older codes (`bw1-bb`, `bkz`, …). TCGdex Japanese cards have Japanese `set_name` but no series. Options for the owner: show the set code in Card Detail when the name is missing (UI only); fill `set_name` from TCGdex Japanese set names in the push (Japanese text; self-applies on the next run); English names need a curated mapping.
  - More (read-only): TCGCSV category 85 group names (`"SV9: Battle Partners"`, cached 2026-09-27) match 211 of 314 ptcgdb codes by code prefix/abbreviation = **14,966 of 19,705 cards (76%) with English names**; gaps are mostly split older sets (`bw1-bb`/`bw1-bw`, `xy1-bx`) that a small manual table could cover. Short codes (`si`, `sd`, `ma`) need review for false matches. The `sets` table has 285 ptcgdb rows whose name is the upper-cased code ("SV4A"), no series; the other 29 codes have no ptcgdb row because English sets own the ID. `explore_filter_options` builds the JPN Set list from `sets` by ID, so the JPN Set filter shows codes for 285 sets and the **English** name for the 29 colliding ones (`sv9` → "Journey Together"). A fix touching set IDs must keep `buildJpnCardKey` (set_id + number) twin matching between TCGdex and ptcgdb working.
- Owner chose both set-name fixes. Quick fix in working tree: `src/lib/cardSetLabel.js` (name, else upper-cased set code; display-only), Card Detail header chip + info line (no stray `()`), `test:card-set-label` (3); `npm run check` exit 0. Also found: all 2,480 Pocket cards have `set_name` NULL on the card (their `sets` rows are named). Every card has a `set_id` and a `sets` row. Owner asked about a stored "Unknown set" placeholder: advised against (display fallback + existing "Uncategorized" filter group instead). Proper-fix plan: `docs/plans/japanese-set-names.md`.
- Next action: owner does a hosted check (also try Source = TCG (JPN) + Has Image = No: the `ja-neo*` cards should appear); (sign in, Explore page 2, Card Detail, share link). Owner decisions for TCGCSV (schema option, goal) and Scrap (set grouping, numbering, images) are listed in the new doc.

### 2026-09-26 (local) - Recently-added index; share preview fix (uncommitted)

- Preflight: model Claude Opus 5.5; tokens ample; full scope. HEAD `4acd961` = origin/v2; remote `main` `94da8f1`.
- Scope: two new owner reports — slow paging with no filters + "Recently added", and missing share previews in iMessage/WhatsApp. The owner's Card Detail re-test result was not provided (placeholder left in the prompt).
- Completed:
  - Diagnosed read-only (details under "Exact next action" in the remediation plan): no `created_at` index → seq scan of ~59k rows per page, 6–11 s and HTTP 500s in production logs; tcgdex share images were an HTML base path or WebP.
  - Owner-approved: `idx_cards_created_at_id` applied (migration `20260927015119_cards_created_at_sort_index.sql`, via SQL, not in history). Index exists (2.2 MB); agent's post-apply EXPLAIN blocked by a permission rule.
  - Share preview fix in `src/lib/sharePreviewImage.js` + `api/share-og.js` + new test `src/lib/__tests__/sharePreviewImage.test.mjs` (`test:share-preview` added to `npm test`). Not committed.
- Validation: `test:share-preview` 5 pass; local handler run on 12 real cards (live RPC); `npm run check:quick` exit 0.
- Migrations touched: `20260927015119_cards_created_at_sort_index.sql` (applied; file uncommitted).
- Open risks: iMessage/WhatsApp cache previews per URL, so previously failed links may keep failing; manual cards whose only image is WebP still send WebP.
- Owner accepted the index as fixed ("sluggish at times but overall more responsive"); logs show 0 errors, mostly 84–960 ms, cold first loads up to 8.9 s. Troubleshooting note is in the remediation plan.
- Owner-approved: committed and pushed as v2 `abc73be`; Vercel status success; live check `/share/card/P-A-054` (WhatsApp UA) → `og:image` `…/P-A/054/high.jpg`.
- Next action: owner shares a never-shared Pocket or Japanese card in iMessage and WhatsApp, and re-tests "Recently added" paging.

### 2026-09-26 (local) - Stale-tab Card Detail fix

- Scope: the owner's production check. Sort, short search and Neo filters passed. Card Detail showed "Something went wrong / error loading dynamically imported module: …/CardDetail-0w3cM7_z.js" in a tab opened before the latest deploy.
- Completed: shared `src/lib/chunkLoadError.js` (detect a stale chunk; reload at most once per 30 s through sessionStorage). Wired into `ChunkErrorBoundary` (`App.jsx`) and `CardDetailErrorBoundary` (`ExplorePage.jsx`). Card Detail now reloads onto the new build, or shows "A new version is available" with Refresh. Details are in plan 4C.
- Validation:
  - `test:chunk-load-error` 5 pass;
  - DuckDB preview browser check, chunk removed mid-session: 7/7;
  - `npm run check` exit 0.
- Migrations touched: none.
- Open risks: tabs opened before this deploy still need one manual refresh (they run the old code).
- Next action: once the Vercel deploy finishes, the owner re-tests Card Detail on production (refresh first). Then, after 2026-09-28 07:30 UTC, verify the scheduled Supabase run.

### 2026-09-26 (local) - Step 3 warm ingest verified; 2C/2E applied

- Preflight: model Claude Opus 5.5; tokens ample; full scope. HEAD `b086039`, remote `main` `e4bddef`.
- Scope: step 3 and step 4 (migrations) of "Exact next action" in `docs/plans/system-performance-ingest-reliability-remediation.md`, plus parallel items the owner picked.
- Completed:
  - Owner-approved dispatch: run `36280555247` on `main` `e4bddef` succeeded in 3.5 min (warm cache). Verified read-only: no collisions; 0 unchanged (first fingerprinted run); pokemontcg.io 20,670 = published; English Neo set names in the TCG filter; `ja-neo1`…`ja-neo4` with 323 cards; `api_hash` filled on all 27,480 published rows. Details are in "Step 3 result".
  - Owner-approved: 2C (`20260926223550`) and 2E (`20260926223742`) applied as SQL through the Supabase MCP tool after the run finished. Header checks passed: 3 functions are service_role/postgres only; partitions through 2028_q3, RLS on, 4 indexes each.
  - Owner decision: the 2 anonymous `auth.users` rows are verified users and stay.
  - v2 `b086039` pushed.
  - Owner-approved `main` sync of the push script + its test (identical to v2 `b086039`; push 61 OK, ingest 14 OK, parity passed in a temporary `main` worktree): `main` `94da8f1`. Pages rebuild `36281141305` was triggered.
  - Playwright hang diagnosed: `@playwright/test` 1.49.1 plus local Node 25.9.0 hangs on any `.mjs` config; 1.63.0 works. CI (Node 24) is unaffected.
  - Owner-approved fix on v2: bumped to ^1.63.0 and installed Chromium. Fixed a stale smoke locator that the working runner exposed (`Batch edit` text matched 2 elements).
  - `npm run check` exit 0 (2/2 smoke passed).
- Validation: SQL checks above; isolated scratchpad repro for Playwright; `npm run check` exit 0. No app code changed.
- Migrations touched: `20260926223550_…` and `20260926223742_…`, now applied.
- Open risks:
  - The 2026-09-28 07:30 UTC run is the first "mostly unchanged" run; check its summary, including the new `ensure_edit_history_partitions` row.
- Next action: after 2026-09-28 07:30 UTC, verify the scheduled Supabase run: mostly "unchanged"; the `ensure_edit_history_partitions` row reports nothing created. Then ask the owner which phase item to take next.

### 2026-09-26 (local) - Neo repair applied and verified

- Scope: step 2 of "Exact next action" in `docs/plans/system-performance-ingest-reliability-remediation.md`.
- Completed:
  - Preconditions re-verified read-only:
    - 323 tcgdex Japanese cards in `neo1`–`neo4`;
    - 0 references from annotations, edit_history, batch_selections, or workbench_queues;
    - all 4 set rows are tcgdex-owned;
    - no workflow running.
  - The owner ran the guarded 1B "Production repair" DO block in the SQL editor. It succeeded.
- Validation (read-only):
  - 0 Japanese cards in `neo1`–`neo4`, and 351 other Neo cards;
  - 4 Neo set rows are `origin='pokemontcg.io'`, still with Japanese names until the next push;
  - tcgdex total is 6,487.
- Migrations touched: none. 2C/2E are still not applied.
- Open risks:
  - The Neo set names stay Japanese in the filters until step 3.
  - The 2026-09-28 07:30 UTC scheduled run uses the new script, so it would also fix the names if step 3 is skipped.
  - The 2 anonymous `auth.users` rows are still undecided.
- Next action: ask the owner to approve step 3, a warm `main` ingest dispatch (`ingest-supabase` workflow on `main`), and then verify it against the step 3 checklist.

### 2026-09-26 (local) - Search RLS fix live; 0C run verified

- Scope:
  - owner reported slow "Raichu" search and page 2;
  - owner reported a "~61 cards found" flash;
  - 0C run finished.
- Completed:
  - Cause: the `cards` SELECT policy's per-row anonymous check blocked the trigram index, because ILIKE is not leakproof. Search seq-scanned ~59k rows: 4.6–5.6 s per page.
  - Owner confirmed the Anonymous provider is off, then ran `ALTER POLICY "authenticated read cards" ON public.cards TO authenticated USING (true)`. Recorded as `20260926232500_cards_select_policy_index_friendly.sql`.
  - Now index-backed: Raichu page 2 8 ms; Pikachu 12 ms warm.
  - `ExplorePage.jsx` count label: "60+ cards found · counting…" instead of "~61".
  - 0C: run succeeded, and every check matched the baseline (see plan 0C "0C result"). Refresh and ANALYZE took 1 attempt each. `api_hash` is still NULL. 323 Japanese rows are back in `neo1`–`neo4`.
- Validation:
  - `npm run check:quick` exit 0;
  - authenticated EXPLAIN ANALYZE before and after (plan Phase 5).
- Migrations touched:
  - `20260926232500_cards_select_policy_index_friendly.sql`: applied by the owner in the SQL editor.
  - 2C/2E: still not applied.
- Open risks: 2 anonymous `auth.users` rows could still read cards if their refresh tokens work. Deleting them needs owner approval.
- Next action: ask the owner to approve step 2 in "Exact next action" (guarded Neo repair SQL), after a quick Vercel re-test of search.

### 2026-09-26 (local) - 4C caching + 3D Explore/Card Detail UX shipped to v2 (0C run still ingesting)

- Scope: the owner picked 4C, then 3D, while run `36274892062` ingests. `abab818` (2C/2E) was pushed first.
- Completed: v2 `06f3927` pushed, which deploys to Vercel Production.
  - 4C: `vercel.json` sets `/assets/*` immutable for 1 year and HTML `no-cache`.
  - 3D:
    - Pokédex/Price/Region sorts hidden on Supabase (they silently sorted by name);
    - 3-character search message (also fixes a skeleton that spun forever);
    - Card Detail arrow keys ignore text fields; dialog role, label, Tab trap and focus restore;
    - eager first grid row.
  - Details are in the plan's 4C and 3D sections.
- Validation: production headers verified after deploy (assets immutable, `/` no-cache). `npm run check:quick` pass. The Playwright **runner hangs locally** (even `--list`; pre-existing, undiagnosed), so a DuckDB preview was driven with the Playwright library instead: 15/15 checks passed. The Supabase sort hiding has unit tests only.
- Migrations touched: none. 2C/2E (`abab818`) are still not applied.
- Risks: the owner should do a quick signed-in look at Explore sort, a short search, and Card Detail on production. Check that nothing else under `/assets/` is expected to change without a new hashed name (none found).
- Next action: when run `36274892062` completes, do the 0C verification (plan "Exact next action" step 1).

### 2026-09-26 (local) - Neo visibility decided; 2C + 2E migrations written (0C run still ingesting)

- Preflight: model Claude Opus 5.5; token feasibility ample; scope: owner picked "keep Neo visible, then 2C and 2E" while run `36274892062` ingests. HEAD `47a00c2`, remote `main` `e4bddef`; `cards.api_hash` verified present.
- Completed (v2 working tree, **uncommitted**):
  - Owner decision: Japanese Neo stays visible. The `neo1`–`neo4` hide list only matches Japanese rows, so it never hides English Neo.
  - 2C: read-only ACL audit, then `supabase/migrations/20260926223550_revoke_client_execute_privileged_functions.sql`. It revokes client EXECUTE on `refresh_explore_filter_options`, `analyze_cards_and_annotations` and `get_card_names_by_source` (SECURITY DEFINER; the last one dumps all card names, bypassing RLS, and has been unused since `99dcfb5`).
  - 2E: `supabase/migrations/20260926223742_edit_history_partition_maintenance.sql` adds `ensure_edit_history_partitions()` (service_role only, RLS on new partitions) and creates 2027-Q3…2028-Q3. Without it, saves break on 2027-07-01.
  - `push_duckdb_to_supabase.py` calls it weekly (nonfatal) and warns when fewer than 2 quarters remain.
- Validation: both migrations exercised on a throwaway local Postgres 18 (details in the plan's 2C/2E sections); push 61 OK (+4), ingest 14 OK, parity passed, `npm run check:quick` exit 0.
- Migrations touched: the two above, **not applied**.
- Risks: the 2E migration briefly takes an ACCESS EXCLUSIVE lock on `edit_history` (lock_timeout 5s). The push change is not on `main` yet, so nothing calls the function weekly until it is synced.
- Next action: when run `36274892062` completes, do the 0C verification (plan "Exact next action" step 1).

### 2026-09-26 (local) - Gate rollout steps 2–4 done; 0C run still ingesting

- Preflight: model Claude Opus 5.5; token feasibility ample; scope full. HEAD `058f802`, remote `main` `ab2e3b6` at start.
- Owner approved doing steps 2–4 while run `36274892062` (0C, old script) ingests:
  - v2 `6746bfc` pushed (`058f802..6746bfc`; gate, migration, tests, plan, log).
  - Migration `20260926220844_cards_api_hash.sql`: the auto-mode classifier blocked the agent, so the owner ran it in the SQL editor. Verified: column, comment, 0 non-null; PostgREST sees it; gate page ~0.46 s.
  - `main` `e4bddef` pushed (`ab2e3b6..e4bddef`, 2 files identical to v2; tests 57/14/parity passed in the `main` tree; temp worktree removed). Pages run `36276305809` triggered.
- Validation: push 57 OK, ingest 14 OK, parity passed (v2 and `main` tree).
- Observation: an anon `limit=1` read of `cards` with a non-`id` column seq-scans the table (RLS hides every row; `name` took 2.1 s, `api_hash` hit the anon timeout). No app impact; noted for auth abuse hardening.
- Open risks: the first fingerprinted run rewrites every row (refresh retries likely); the Neo repair SQL may need the owner to run it (classifier); Japanese Neo visibility is an owner decision.
- Next action: when run `36274892062` finishes, do the 0C verification (plan "Exact next action" step 1), then ask for the Neo repair.

### 2026-09-26 (local) - 0C run dispatched; Neo collision found; publication gate implemented (uncommitted)

- Owner approved: `main` ingest dispatch (run `36274892062`, cold cache, in progress at the time of writing = 0C run); investigate the 14-row gap; implement "skip unchanged rows" with the collision guard and `ja-` Neo namespacing.
- Found: TCGdex Japanese reuses `neo1`–`neo4`, so every push overwrites English `neo4-100`…`neo4-113` and the four English Neo `sets` rows. The TCG set filter shows Japanese names for the Neo sets. None of the affected rows are annotated. An earlier workaround hid Japanese Neo (`HIDDEN_JPN_SET_IDS`, migration 045).
- Implemented (v2 working tree, uncommitted):
  - migration `20260926220844_cards_api_hash.sql` (not applied);
  - `PublishGate` in `push_duckdb_to_supabase.py`: fingerprints, collision skip + report, fallback without the column;
  - `ja-` IDs for colliding Japanese sets at publish time (a deviation: not in `ingest.py`);
  - 19 new tests;
  - docs: 1A, 1B "Publication gate", "Exact next action".
- Validation: push 57 OK, ingest 14 OK, parity passed, `npm run check:quick` exit 0, local dry run OK. Read-only preconditions for the Neo repair checked (FK to sets; 0 references to the 323 Japanese Neo rows).
- Migrations touched: `20260926220844_cards_api_hash.sql` (written, not applied).
- Open risks: the first run after the migration rewrites every row once; Japanese Neo becomes visible (owner decision); in-place API card edits are no longer reverted by the push.
- Next action: after run `36274892062` finishes, do the 0C verification, then ask the owner for steps 2–6 in the plan's "Exact next action".

### 2026-09-26 (local) - Refresh headroom fix shipped to v2 and `main`; 0C = Monday scheduled run

- The owner approved all three: v2 `6766075` pushed (`b252f80..6766075`); `main` sync `ab2e3b6` pushed (`ef0d0d6..ab2e3b6`; `push_duckdb_to_supabase.py` + its test only, identical to v2; tests 38/14/parity passed in the `main` tree; temp worktree removed). v1 Pages rebuild run `36274769225` was triggered by the push.
- 0C: the scheduled `main` run on 2026-09-28 07:30 UTC is the 0C run; there is no manual dispatch.
- Next action: after that run finishes, complete the 0C verification per the plan's "Exact next action", then ask the owner for the phase-gate sign-off.

### 2026-09-26 (local) - Refresh timeout headroom diagnosed; script-only fix (uncommitted)

- Preflight: model Claude Opus 5.5; token feasibility ample; scope full. HEAD `b252f80`; remote `main` `ef0d0d6` (the sync landed on top of `2e5543a`).
- Diagnosis:
  - The limit is `service_role` `statement_timeout=60s`; the server cancelled at 60 s, and the client's 69 s adds HTTP overhead.
  - Postgres logs show a checkpoint flushing the upsert's rewritten pages from 21:33:51 to 21:38:21. Meanwhile a trivial `cards` seq scan took 56.8 s, so the whole database was I/O-bound. Once the checkpoint ended, the refresh took 16.5 s.
  - A function-level `SET statement_timeout` was tested and cannot extend the caller's timer. ANALYZE-first was rejected because the plan is not the issue.
  - Root cause: every push rewrites about 36k unchanged rows. Added as a Phase 1A item.
- Completed:
  - `scripts/push_duckdb_to_supabase.py`: maintenance retries now 5 attempts with `(15, 30, 60, 120)` s backoff, so retries outlast one 300 s checkpoint cycle; worst case about 9.5 min.
  - Test updated plus a new retry-window invariant test.
  - Plan: 0B.3 "Refresh timeout headroom", 1A item, 0C pre-run baseline, "Exact next action".
- Validation: push tests 38 OK, ingest 14 OK, parity passed, `npm run check:quick` exit 0. Read-only production SQL and logs; the temp-function probe was rolled back.
- Migrations touched: none. Nothing committed, pushed, applied, or dispatched.
- Open risks (the retry risk was resolved by `ab2e3b6`): The 14-row gap (pokemontcg.io 20,656 in the database vs 20,670 published) is unexplained.
- Next action: owner approves (a) the v2 commit and push, and (b) syncing the two push-script files to `main` before Monday, so the scheduled run serves as 0C.

### 2026-09-26 (local) - 0B.3 ingest-only `main` sync landed

- Owner explicitly authorized; committed the staged worktree as `ef0d0d6` on `main` (`2e5543a..ef0d0d6`; 8 files identical to v2 `ee01e4b`), pushed; v2 docs `77dbfa5` pushed; scratchpad worktree removed. Push to `main` triggers a v1 Pages rebuild (ingest steps there run only on schedule/dispatch).
- Next action: diagnose `explore_filter_options` refresh timeout headroom; watch the 2026-09-28 scheduled runs (Pages 06:00 UTC, Supabase ingest 07:30 UTC, cold cache on `main`).

### 2026-09-26 (local) - Phase 1B tcgdex Japanese twin slice; `main` sync re-staged

- Preflight: model Claude Opus 5.5; token feasibility ample; scope full.
- Branch: `v2/supabase-migration` at `ee01e4b` (pushed with owner approval). Plan: remediation plan 1B "tcgdex Japanese twin slice".
- Completed: `push_japanese_cards` now skips TCGdex Japanese rows whose PTCG-db twin is published (or staged under `--include-ptcgdb`); owner-approved guarded delete of 8,451 unannotated twins (tcgdex Japanese 12,781 → 4,330), then filter-view refresh + ANALYZE. `main` sync re-staged from `ee01e4b` (8 files, +2,734/−142) in the scratchpad worktree; not committed.
- Validation: push tests 37 OK (7 new), ingest 14 OK, parity pass (in v2 and in the `main` worktree); `npm run check:quick` exit 0; production SQL confirmed expected skip count 8,451, zero references to the deleted rows, post-delete counts.
- Migrations touched: none.
- Open risks: materialized-view refresh timeout headroom; 107 empty TCGdex Japanese `sets` rows (hidden from Explore); twin match relies on the shared ID rule in `ingest.py` and the push script.
- Next action: owner explicitly authorizes the `main` commit + push of the staged sync.

### 2026-09-26 (local) - Phase 0B.3 validated by Actions run; `main` sync staged

- Preflight: model Claude Opus 5.5; token feasibility ample; scope full.
- Branch: `v2/supabase-migration` at `7c59a25`, pushed with owner approval (`ff5a374..7c59a25`). Plan: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.3 "Validation run").
- Completed: owner-approved dispatch of run `36273193023` — success in 8m27s (tests 30/14/parity; cache restore+save; ingest 58 s success; push 7m11s; PTCG-db skipped 0 staged; MV refresh succeeded on attempt 3/3 after two `57014`; ANALYZE 18.4 s; failure-only steps skipped). Prepared ingest-only `main` sync as staged, uncommitted changes in a scratchpad worktree on `origin/main` `2e5543a` (8 files, +2,538/−142; tests pass there).
- Findings: 8,451 unannotated tcgdex Japanese rows duplicate `ptcgdb` cards (re-created by the 2026-09-26 recovery runs; `push_japanese_cards` has no cross-source check); `main` currently publishes no Japanese cards, so the sync would make the weekly schedule republish them. MV refresh has almost no timeout headroom.
- Validation: run logs; read-only SQL counts against production; tests in the `main` worktree.
- Migrations touched: none. No production rows deleted; `main` untouched.
- Open risks: see findings; step-summary panel only visible in the signed-in UI.
- Next action: owner decides order of the tcgdex-twin publish fix (1B slice) vs. the `main` sync (recommended: fix first, include in sync).

### 2026-09-26 (local) - Phase 0B.3 review: APPROVED

- Preflight: model Claude Opus 5.5; token feasibility likely; scope full (review only).
- Branch: `v2/supabase-migration` at `954a5bd` (verified). Plan: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.3 "Review").
- Completed: reviewed `git show 954a5bd`; verified all nine checked 0B.3 boxes; confirmed remote `main` = `2e5543a`; checked publish gate, timeouts (300/45/350), concurrency, `bash` pipefail + `tee` (simulated), redaction-before-upload, PTCG-db opt-in, v1 `--skip-japanese`.
- Validation: `test_ingest.py` 14 OK; `test_push_duckdb_to_supabase.py` 30 OK; `test_jpn_card_key.py` pass; `npm run check:quick` exit 0.
- Migrations touched: none.
- Review fixes (owner-approved, applied, committed with the review notes): upload log artifact only if redaction succeeded; `PYTHONUNBUFFERED=1` in the job env.
- Open risks: workflow still unexercised by a real Actions run. Nothing pushed, dispatched, or synced to `main`.
- Next action: owner decides on a v2 `workflow_dispatch` validation run (writes to production Supabase), then on the ingest-only `main` sync listed under 0B.3 "Proposed `main` sync".

### 2026-09-26 (local) - Phase 0B.3 v2-side hardening (awaiting review)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5)
  - Token-feasibility declared: likely
  - Scope selected: scoped (v2-side 0B.3 only; no `main` changes)
- Branch: `v2/supabase-migration`; the three 0B.4 commits were pushed at the owner's request (`955aaa3..ff5a374`).
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.3 section has the re-diff table, findings, implementation, validation, and proposed `main` sync).
- Owner decisions: (A) v1 Pages ingest gets `--skip-japanese` but **not** `--fail-on-partial`; (B) PTCG-db publication is opt-in via `push_duckdb_to_supabase.py --include-ptcgdb`, with no workflow input.
- Completed:
  - Re-diffed the ingest unit against remote `main` `2e5543a` (local `main` is stale). `jpn_card_key_utils.py` and all three tests are absent on `main`; `requirements-ci.txt` is identical.
  - `ingest-supabase.yml`: read-only permissions, non-cancelling concurrency, job/step timeouts (350/300/45 min), pipefail + `tee` logs, jpn parity test, "Publication skipped" summary, secret-scrubbed log artifact on failure.
  - `ingest.py` / `push_duckdb_to_supabase.py`: step summaries (row counts, durations, refresh/ANALYZE results); PTCG-db opt-in gate.
  - `deploy-pages.yml`: `--clear-failed --skip-japanese`.
- Validation run:
  - `npm run check:quick` (pass); `test_ingest.py` 14 passed; `test_push_duckdb_to_supabase.py` 30 passed; `test_jpn_card_key.py` passed.
  - Local `push_duckdb_to_supabase.py --dry-run` with `GITHUB_STEP_SUMMARY` set rendered the expected summary; no writes.
  - Workflow YAML parses; pipefail/tee and redaction behavior simulated locally. Not yet exercised on GitHub Actions.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Workflow changes are unproven until a real Actions run; first `main` run starts without cached progress (~3.5 h observed).
  - `main` is untouched; the sync needs explicit owner approval.
- Next action (single first step):
  - Owner reviews the 0B.3 commit and decides whether to validate via a v2 `workflow_dispatch` (writes production Supabase) and whether to authorize the ingest-only `main` sync.

---

### 2026-09-26 (local) - Phase 0B.4 accepted

- Continuation of the 0B.4 session (Claude Opus 5.5).
- Owner post-apply check: `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13` (matches the committed function body), ACL unchanged. Owner moved cards between Workbench lists in the app on Vercel: passed.
- Branch: `v2/supabase-migration`; 0B.4 commits are local, **not pushed** (push only when the owner asks). `main` untouched.
- Open risks: concurrent moves untested (Phase 2A); `PUBLIC`/`anon` EXECUTE remains (Phase 2C). Remote migration history still tracks only `001`–`029`; never run `supabase db push`.
- Next action (single first step):
  - Owner decides whether to push the 0B.4 commits, then which slice is next (0B.3 needs explicit `main` authorization; otherwise 0C or 1E.1–1E.3).

---

### 2026-09-26 (local) - Phase 0B.4 committed and applied

- Preflight: continuation of the accepted 0B.4 session (Claude Opus 5.5); owner approved order-preserving dedupe, commit, and applying the migration.
- Branch: `v2/supabase-migration` — `3907b09` committed locally, **not pushed**; `main` untouched.
- Migration applied to production as SQL via `execute_sql` (no error returned; untracked in migration history like 030–057):
  - `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql`
- Validation:
  - Pre-apply rolled-back tests passed (see the previous entry and the plan's "0B.4 results").
  - Post-apply read-only check **not run by the agent** (blocked by a tool permission rule). Expected: `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13` (hash of the committed function body), ACL unchanged.
- Open risks:
  - Deployment is unconfirmed until the post-apply check and a signed-in app move pass.
  - Concurrent moves untested (Phase 2A); `PUBLIC`/`anon` EXECUTE remains (Phase 2C).
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` remain untracked; do not commit.
- Next action (single first step):
  - Owner runs the post-apply check query and moves a card between two Workbench lists in the app; then mark 0B.4 accepted and decide whether to push `3907b09`.

---

### 2026-09-26 (local) - Phase 0B.4 Workbench move hotfix (migration written and tested; not applied, not committed)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5, `claude-opus-5-5`)
  - Token-feasibility declared: likely
  - Scope selected: 0B.4 only
- Branch: `v2/supabase-migration` at pushed `955aaa3`; nothing committed, pushed, applied, or dispatched; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.4 checklist + "0B.4 results")
- Completed:
  - Reproduced as the owner (rolled back): `ERROR 42804: COALESCE types jsonb and text[] cannot be matched` (038 function, line 55). Every production move fails before writing.
  - New migration `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql`: JSONB read (`jsonb_array_elements_text`) and write (`to_jsonb`), same signature, both rows locked `ORDER BY id FOR UPDATE`, SECURITY INVOKER + RLS unchanged, ACL kept. Order-preserving dedupe replaces 038's `SELECT DISTINCT` (recommended; owner to confirm).
- Validation run:
  - One rolled-back transaction as `authenticated` with the owner's and a second real user's claims: owner move, duplicates, already-in-target, capacity overflow, not-in-source, same list, shared list in both directions, other user's private list (not found), anonymous (sign-in required), all stored elements JSON strings. All as expected (table in plan).
  - After rollback: deployed function hash/ACL unchanged, no test rows, real lists 2/6/7 unchanged.
  - `npm run check:quick` not run (no app code changed).
- Migrations touched:
  - `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql` (created, **not applied**)
- Open risks or assumptions:
  - Concurrent moves untested (Phase 2A). The app/PostgREST path is confirmed only by signed-in QA after applying.
  - `PUBLIC`/`anon` still hold EXECUTE (rejected at runtime by the sign-in check; Phase 2C).
  - Remote migration history tracks only `001`–`029`; never run `supabase db push`.
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` remain untracked; do not commit.
- Next action (single first step):
  - Owner reviews the migration; on approval, commit it with the plan/log updates, apply its SQL once, run the post-apply check, and move a card between two lists in the app.

---

### 2026-09-26 (local) - Phase 0B.2 committed, pushed, and migrations applied

- Preflight: continuation of the accepted 0B.2 session (Claude Opus 5.5); owner approved commit, push, and applying migrations.
- Branch: `v2/supabase-migration` — `6f36a0d` (0B.2), `3bde76b` (Pocket badge fix), pushed `bff91cc..3bde76b`; Vercel auto-deploys. `main` untouched.
- Migrations applied to production (as SQL, in order; untracked in migration history like 030–057):
  1. `20260926092111_service_role_maintenance_timeout.sql` — `service_role` rolconfig now `statement_timeout=60s, lock_timeout=60s`.
  2. `20260926092113_refresh_explore_filter_options_concurrently.sql` — verified CONCURRENTLY, `search_path=""`, ACL unchanged.
  3. `20260926092115_explore_filter_options_annotation_facets.sql` — 4 rows, `facets_version` 1, specialties ACE SPEC/Pokémon Tool/Pokémon Tool F/Technical Machine, 42 actions, 32 poses; ACL SELECT for authenticated + service_role only.
- Validation: as `service_role` with 60 s limit — refresh 7.5 s, ANALYZE 12.5 s; authenticated read of the view OK; `npm run check:quick` pass before push.
- Open risks:
  - PostgREST/service-key path not exercised by the agent (no key access); confirm on the next ingest run's log.
  - Remote migration history tracks only `001`–`029`; never run `supabase db push`.
  - Mobile zoomed-out load shelved (not reproduced). Remaining stale `VITE_USE_FILTER_OPTIONS_RPC` doc references listed in the plan.
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` are untracked; do not commit.
- Next action (single first step):
  - Phase 0B.4: reproduce the Workbench move error as an authenticated user and record the error text.

---

### 2026-09-26 (local) - Phase 0B.2 implemented (uncommitted; migrations created, not applied)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5, `claude-opus-5-5`)
  - Token-feasibility declared: likely
  - Scope selected: full 0B.2
- Branch: `v2/supabase-migration` at pushed `bff91cc`; nothing committed, pushed, deployed, or dispatched; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.2 checklist + "0B.2 results")
- Completed:
  - Timeout budget migration (`service_role` statement/lock timeout 60 s + `NOTIFY pgrst, 'reload config'`); docs cited. **Flag:** 60 s instead of the preferred 120 s because Supabase documents a 60 s max for Client API queries.
  - CONCURRENTLY refresh migration (SECURITY DEFINER, `search_path = ''`, ACL unchanged).
  - View facets migration: Specialty (card subtypes), Action/Pose (annotations) in the `tcg` row + `facets_version: 1`; recreated view grants SELECT to authenticated/service_role only.
  - Push script: bounded retry/backoff (3 attempts, 5 s/15 s); refresh exhaustion fatal with `::error`; ANALYZE exhaustion nonfatal with structured `::warning`.
  - Explore filter options: view → automatic split-RPC fallback → explicit error with Retry; facets degrade alone (static lists + amber notice); live sets overlay on both paths; no client-paged 5,000-row path; capped form-option helpers now throw instead of truncating.
- Validation run:
  - `npm run check:quick` (pass, exit 0); Python push tests 19 passed; new Node tests 16 passed.
  - Migrations: `pglast` parse-only OK; full new view query `PREPARE`d against live schema OK; not applied.
  - Read-only authenticated timings: split RPCs TCG 704 ms, Pocket 609 ms, Custom 24 ms, Japanese 1,662 ms; standalone facet RPC 6.3 s cold / 2.5 s warm (rejected); facet CTEs add ~5.1 s to refresh.
- Migrations touched (all **created, not applied**; apply in this order with owner approval):
  1. `supabase/migrations/20260926092111_service_role_maintenance_timeout.sql`
  2. `supabase/migrations/20260926092113_refresh_explore_filter_options_concurrently.sql`
  3. `supabase/migrations/20260926092115_explore_filter_options_annotation_facets.sql`
- Open risks or assumptions:
  - **Until migration 1 is applied, any v2 ingest run will go red at the refresh step. This is expected, not a regression.**
  - Post-migration durations are estimates (~17 s refresh) until the timed service-key RPC check runs.
  - Stale `VITE_USE_FILTER_OPTIONS_RPC` / client-paged references remain in `CLAUDE.md` and several `docs/plans/*` files (left untouched to keep the diff scoped and preserve pending edits).
  - New migrations use CLI timestamp names; existing ones use `NNN_`. Check remote migration history format before `db push`.
  - Owner QA: Pocket badge on Japanese cards fixed in the working tree (`src/lib/cardSource.js`, separate commit from 0B.2); mobile zoomed-out load not reproduced — needs details. Owner chose to keep the 60 s timeout.
- Next action (single first step):
  - Owner reviews the uncommitted 0B.2 diff (including 60 s vs 120 s); on approval, commit, then apply migrations 1→2→3 and run the timed refresh/ANALYZE RPC verification.

---

### 2026-09-26 (local) - Independent plan review; corrections applied to remediation plan

- Preflight sent and accepted:
  - Model: Claude Opus 5.5 (owner-requested review)
  - Token-feasibility declared: likely
  - Scope selected: review + documentation corrections only
- Branch: `v2/supabase-migration` at `bff91cc`; `main` untouched. No code, migration, or deploy changes.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (new section "Plan review 2026-09-26")
- Completed:
  - Checked plan claims against code and the live Supabase DB (read-only `pg_roles`, `pg_attribute`, `pg_proc` queries).
  - **Found the root cause of the `57014` failures:** `service_role` has no `rolconfig`, so PostgREST RPCs inherit `authenticator`'s `statement_timeout=8s` / `lock_timeout=8s`. The MV refresh takes ~12 s, so the planned "retry then fail" would make every weekly run red without refreshing. 0B.2 now fixes the timeout budget first (preferred: `ALTER ROLE service_role SET statement_timeout`), then adds retries and a CONCURRENTLY refresh.
  - **Found a production bug:** live `workbench_queues.card_ids` is `jsonb`, but deployed `move_workbench_cards` uses `text[]` with no conversion, so moves should error. Pulled forward from Phase 2A to new slice 0B.4.
  - 0B.2 now requires an explicit source for Specialty/Action/Pose (neither the MV nor the split RPCs supply them).
  - Fixed stale text: 0B.1 acceptance is reflected everywhere; the Phase 5 `set_name` OR removal is marked done (`bff91cc`). Phases 5–6 are marked optional pending owner confirmation.
- Validation run:
  - Documentation-only; no code validation run.
- Migrations touched:
  - None (0B.2 timeout and 0B.4 move-RPC migrations are specified, not written).
- Open risks or assumptions:
  - It is not yet verified that PostgREST applies an `ALTER ROLE service_role SET statement_timeout` to impersonated requests; confirm in the docs and by a timed RPC call after applying.
  - The Workbench move failure is inferred from the deployed types and function body; reproduce it in the app before fixing.
  - Other pre-existing modified/untracked files remain untouched.
- Next action (single first step):
  - Ask the owner whether to do 0B.4 (Workbench move hotfix) before or after 0B.2; then start with that slice's first reproduce/verify step. Applying any production migration requires explicit owner approval.

---

### 2026-09-26 01:47 (local) - Phase 0 plan reconciliation after manual ingest recovery

- Preflight sent and accepted:
  - Model accepted: yes (`GPT-5.6 Sol`, accepted earlier in this session)
  - Token-feasibility declared: likely
  - Scope selected: documentation reconciliation only
- Branch: `v2/supabase-migration` at pushed commit `bff91cc`; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md`
- Completed:
  - Reconciled the plan with pushed commits `79267ef`, `4493d76`, and `597532d`.
  - Recorded the successful manual publication and the swallowed `57014` failures from run `36228427545`; latest run output reported 12,781 TCGdex Japanese rows.
  - Split Phase 0B into: trustworthy Site Checks/indexed set queries, post-push/filter-option correctness, and a recalculated owner-approved default-branch sync.
  - Recorded partial Phase 1 progress for incremental TCGdex reconciliation, bounded resume behavior, and run-specific progress caches.
  - Promoted the set-query timeout and incomplete Specialty/Action/Pose/fallback behavior into Phase 0B because they block Phase 0C authenticated Explore acceptance.
  - Reconciled concurrently completed commit `bff91cc`: set-ID-only grid/count filtering and Python-enabled Site Checks are pushed; GitHub Site Checks run `36230895162` passed.
  - Expanded `docs/plans/p1-cutover-and-operations.md` §6 with a deferred owner-only merge gate that preserves Vercel routing, Supabase URL/auth redirects, and intentional GitHub Pages behavior.
  - Added distinct Phase 1E for Pocket source replacement/hardening after verifying TCGdex exposes 15 sets through `B2a` while `pokemon-tcg-pocket-database` 2.10.0 lists 23, including eight newer/missing sets.
  - Added canonical-ID/foreign-key guardrails, promo set mapping, fixture adapter, dry-run reconciliation, optional Storage/image rights gate, production integrity checks, and scheduled source-freshness monitoring.
  - Owner completed signed-in Phase 0B.1 QA: `me55`, `B2a`, and combined Source=All filtering load cards/counts without query errors. Phase 0B.1 is accepted.
- Validation run:
  - Documentation-only update; no code validation run in this slice.
  - Verified latest remote branch state and GitHub run logs.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Other pre-existing modified/untracked files remain unrelated and untouched.
  - Automated hosted access remains blocked here by Vercel Deployment Protection (403) plus application email authentication; the owner supplied the signed-in QA result.
  - Most `B2a` images remain missing despite successful set queries. This is Phase 1E data-quality work, not a Phase 0B.1 query failure. Source replacement is not authorized, and image mirroring requires a separate artwork-rights/Storage-policy owner decision.
  - Materialized-view refresh still stays green after exhausted `57014`; Specialty/Action/Pose and capped fallback fixes are not implemented.
  - No `main` authorization has been given.
- Next action (single first step):
  - Start only Phase 0B.2 post-push maintenance/filter-option work and stop for review afterward; do not begin Phase 1E or touch `main`.

---

### 2026-09-25 20:55 (local) - Phase 0A approved and committed

- Branch: `v2/supabase-migration`
- Commit: `6869e2d` — "Phase 0A: harden ingest empty-checkout init and cover adaptive batching" (not pushed; `main` untouched).
- Contents: `package.json`, `scripts/ingest.py`, `scripts/test_ingest.py`, `scripts/test_push_duckdb_to_supabase.py`, `docs/plans/system-performance-ingest-reliability-remediation.md`, and the Phase 0A/audit entries in this log. Unrelated working-tree changes left unstaged.
- Plan status: Phase 0A completed and owner-approved; Phase 0B not started.
- Open risks or assumptions:
  - This entry is uncommitted (a commit cannot record its own hash); include it with the next commit.
- Next action (single first step):
  - When the owner authorizes Phase 0B, run the ingest-unit diff against `main` listed in the plan's Exact next action.

---

### 2026-09-25 20:45 (local) - Phase 0A review follow-ups

- Branch: `v2/supabase-migration`
- Completed:
  - `package.json`: `check:quick` now also runs `python scripts/test_ingest.py` and `python scripts/test_push_duckdb_to_supabase.py`.
  - Plan top-level status updated to "Phase 0A implemented (uncommitted), awaiting owner approval; Phase 0B not started".
- Validation run:
  - Focused tests: 5/5 and 10/10 pass. `npm run check:quick` passes (includes both scripts).
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Nothing committed or pushed; `main` untouched.
- Next action (single first step):
  - Owner approves 0A; then commit 0A on `v2/supabase-migration` and start Phase 0B with the ingest-unit diff against `main`.

---

### 2026-09-25 20:30 (local) - Phase 0A ingest empty-checkout fix + batching tests

- Preflight sent and accepted:
  - Model: Claude Opus 5.5 (owner-directed phase request)
  - Token-feasibility declared: likely
  - Scope selected: Phase 0A only
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (Phase 0A results section)
- Scope in this slice:
  - Review retained adaptive batching (`2a209f0`) and `clear_failed_sets()` (`74a4875`), both already committed; neither changed.
  - Harden `get_connection()` to create the DuckDB parent directory.
  - Add regression and batching tests.
- Completed:
  - `scripts/ingest.py`: parent-directory creation in `get_connection()`.
  - `scripts/test_ingest.py`: 5 tests covering a nonexistent path, a table-less file, an older schema missing `failed_sets`, existing rows, and an offline CLI `--clear-failed` run (network patched to fail).
  - `scripts/test_push_duckdb_to_supabase.py`: 10 tests covering repeated shrinkage, the minimum-size floor, a final short batch, exactly-once submission, fatal non-timeout errors, and dry run.
- Validation run:
  - Before: pre-fix `ingest.py` raises `CatalogException: Table with name failed_sets does not exist!`.
  - Focused tests: 5/5 and 10/10 pass. Dry-run push on a fresh fixture: exit 0.
  - `npm run check:quick` (pass)
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Changes are uncommitted pending review. Corrupt/0-byte DuckDB is still fatal by design. Scheduled runs still use `main` code until Phase 0B.
- Next action (single first step):
  - Reviewer reruns `python scripts/test_ingest.py && python scripts/test_push_duckdb_to_supabase.py && npm run check:quick`; if approved, commit 0A and start Phase 0B with the ingest-unit diff against `main` listed in the plan's Exact next action.

---

### 2026-09-25 20:06 (local) - System remediation plan handoff

- Preflight sent and accepted:
  - Model accepted: yes (`GPT-5.6 Sol`)
  - Token-feasibility declared: likely
  - Scope selected: full documentation plan
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md`
- Scope in this slice:
  - Convert the read-only performance/ingest/database/deployment audit into a durable phased implementation and review plan.
- Completed:
  - Added verified baseline, guardrails, success criteria, phase dependencies, acceptance gates, validation steps, backout guidance, and reviewer/implementer handoff contract.
  - Prioritized active ingest recovery before performance tuning.
  - Preserved the owner-only `main` policy: ingest-only sync still requires explicit authorization.
- Validation run:
  - Markdown-only change; no new code validation required.
  - Audit baseline before this documentation slice: `npm run check:quick` passed.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Scheduled Supabase ingest remains broken until Phase 0 is implemented and an approved ingest-only sync reaches the default branch.
  - Existing unrelated working-tree changes must be preserved.
- Next action (single first step):
  - Start Phase 0A on `v2/supabase-migration`: review the existing adaptive batching diff, add an empty-DuckDB `--clear-failed` regression test, fix initialization order, and run `npm run check:quick`; stop for review before any `main` change.

---

### 2026-05-16 — Workbench annotation jump-chip overflow quick fix

- Branch: `v2/supabase-migration`
- Scope in this slice:
  - Quick usability fix for Workbench `AnnotationEditor` sticky section jump chips consuming too much vertical space when they wrap.
- Completed:
  - `src/components/AnnotationEditor.jsx` jump toolbar now stays one row and scrolls horizontally.
- Validation run:
  - `npm run build` (pass)
- Migrations touched: none
- Open risks or assumptions:
  - This is intentionally a quick unblock, not a final navigation design. Revisit later for a more polished responsive section navigator, likely a dropdown or hybrid chips + More menu for narrow Workbench panes.
- Next action (single first step):
  - After current performance work, review Workbench annotation-pane navigation UX and decide whether to replace horizontal scrolling chips with a compact section selector.

---

### 2026-05-13 — tcgdex/ptcgdb dedup + bug fixes (React #31, Keep set & source)

- Preflight sent and accepted: n/a (continued from prior session)
- Branch: `v2/supabase-migration`
- Plan doc: n/a (ad-hoc investigation + fixes)
- Scope in this slice:
  - Investigate "SV4a-005 appears twice" report → surfaced 3,605 real cross-source duplicates (tcgdex ↔ ptcgdb) plus 5,657 false positives (manual cards with bad metadata).
  - Dedup: deleted 3,605 tcgdex copies where ptcgdb counterpart existed (ptcgdb has better rarity coverage: 100% vs 73.3%). Annotations migrated before deletion. 16,100 unique ptcgdb cards preserved.
  - Fix React error #31 in CardDetail More Info tab: `String()` wrappers on `atk.damage`, weakness/resistance `type`/`value`.
  - Fix "Keep set & source" toggle: restore `setIdVal` directly in snapshot restore; useEffect auto-derivation was skipped for source="TCG".
- Completed:
  - Dedup SQL run successfully in Supabase (transaction with annotation migration + DELETE).
  - Bug fixes committed (2ee1b81) and pushed to `v2/supabase-migration`.
  - CLAUDE.md updated with all work.
- Validation run: zero remaining tcgdex/ptcgdb overlaps confirmed via SQL.
- Migrations touched: none (manual SQL, no migration file)
- Open risks or assumptions:
  - `japanese_cards_ptcgdb` table absent from current DuckDB — ptcgdb cards won't re-push, so duplicates won't recur. If ptcgdb ingest is re-enabled, fix the push script to use consistent ID formats or add a dedup step.
  - Manual `pokumon-*` cards have garbage `set_id`/`number` metadata from v1 migration; these aren't duplicates but pollute the `set_id + number` grouping. Consider a cleanup migration to normalize these fields.
  - React #31 fix addresses known object-valued API fields; other raw_data fields could surface similar issues — watch for future reports.
- Next action (single first step):
  - If duplicates reappear after a Japanese card ingest: check whether `japanese_cards_ptcgdb` table was re-created in DuckDB and normalize ID formats in the push script.

---

- Preflight sent and accepted: n/a (documentation request)
- Branch: `v2/supabase-migration` (context applies to v2)
- Plan doc: `docs/plans/supabase-perf-hosting-alternatives-notes.md` (new)
- Scope in this slice:
  - Capture codebase audit findings (Explore `fetchCards`, exact counts, debounced count, prefetch, artist two-step, filter MV path, RLS 057, no Realtime data channels).
  - Capture recommendation order: upgrade tier first; then evidence-led refactor (counts/prefetch/artist); alternative Postgres only for strategic reasons; Appwrite/PocketBase as replatform not hosting swap.
- Completed:
  - Added `docs/plans/supabase-perf-hosting-alternatives-notes.md`.
  - Linked from `CLAUDE.md` under V2 Stack (performance and hosting reference).
- Validation run: n/a (markdown only)
- Migrations touched: none
- Open risks or assumptions:
  - Findings are static; re-validate with Supabase metrics when acting on them.
- Next action (single first step):
  - When revisiting speed: open `docs/plans/supabase-perf-hosting-alternatives-notes.md` § “Next action when revisiting” and profile dominant cost (count vs fetch vs join) before changing code or plan.

### 2026-05-09 — Materialized view for Explore filter options (054)

- Preflight sent and accepted: n/a (continued from prior session)
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/v2-bundle-performance-optimization.md`
- Scope in this slice:
  - Materialized view `explore_filter_options` (migration 054) to replace client-paged distinct cascade.
  - CardGrid visual regression fix (revert @tanstack/react-virtual).
  - Vercel deploy fix (remove `_comment` from `vercel.json` rewrites).
  - App adapter 3-tier fallback: materialized view → split-RPC → client-paged.
  - Context docs trimmed (CLAUDE.md: 365→~180 lines; handoff log: 206→~70 lines).
- Completed:
  - `supabase/migrations/054_explore_filter_options_materialized_view.sql` — applied and populated.
  - `src/data/supabase/appAdapter.js` — `fetchExploreFilterOptions()` reads materialized view first (<50ms).
  - `scripts/push_duckdb_to_supabase.py` — calls `refresh_explore_filter_options()` after upserts.
  - `src/components/CardGrid.jsx` — reverted to CSS grid + React.memo + lazy loading.
  - `vercel.json` — removed `_comment` property (Vercel rejects unknown keys).
- Validation:
  - `npm run check:quick` (pass — build 5.05s)
  - Manual QA: owner confirmed filter options load "much faster" on Vercel preview.
- Migrations touched:
  - 053 (applied, opt-in), 054 (applied, default fast path)
- Open risks:
  - Materialized view must be refreshed after ingest. Auto-refreshed in push_duckdb_to_supabase.py.
  - Grid query (fetchCards) still ~8.6s on free tier — needs composite indexes.
  - `public/data/pokemon.duckdb` is 179MB (exceeds GitHub 100MB limit) — not committed.
- Next action:
  - Run `ANALYZE cards` in Supabase SQL Editor, then profile the 8.6s grid query for missing indexes.

---

### 2026-05-02 — TCGdex JP / Pocket image URLs in `ingest.py`

- Branch: `v2/supabase-migration`
- Scope: Japanese + Pocket card rows where TCGdex omits `image` or base path breaks on CDN.
- Completed:
  - `tcgdx_card_high_webp_url(..., japanese_locale=...)` resolves `ja/...` vs `en/...` using cached HEAD.
  - `ingest_japanese_cards` / `ingest_pocket_cards` pass `serie_id` and use this helper.
- Validation: manual `python3 -c` smoke for SM12 vs SV1S synthetic URLs.
- Next action: Re-run Japanese ingest with `--force` then `push_duckdb_to_supabase.py` to backfill image URLs.

### 2026-05-02 — Camera angle multi-select confirmed

- Owner confirmed camera_angle should be multi-select. Migration 044 spec written (not yet implemented at time of entry).
- **Uncommitted changes in working tree** (3 files, 91 lines): First/Last buttons, case-insensitive dedup, `syncReactQueryCardCaches`, debounced form-options invalidation, `staleTime` + `refetchOnWindowFocus` on workbenchCard query. These were Phase 0 — may already be committed in subsequent sessions.
- Next action: Commit Phase 0 changes, then begin Phase 1 (direct cache writes for Workbench nav).
