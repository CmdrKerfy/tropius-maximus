# Tropius Maximus — Project Context

## What This Is

Pokemon TCG database and collection tracker. 15,000+ cards from multiple APIs, with 50+ annotation fields for cataloging card artwork, themes, and metadata. Used by 1-3 people (2 non-technical).

## Current State: Mid-Migration (v2) — deploy testing; cutover not merged

The project is actively being migrated from v1 (GitHub Pages + DuckDB-WASM) to v2 (Supabase + Vercel). **Both versions coexist in the repo on different branches.**

**Owner decision (ongoing):** Keep **GitHub Pages (v1)** and **Vercel (v2)** **separate** for now—no merge to `main` required for two live URLs. **Freeze the old site for submissions** so users do not add custom cards or annotations on v1 by mistake; canonical editing is **Vercel v2** only. Enforcement can be operational (stop sharing the old URL, replace Pages with a static “moved” page) and/or a small **v1** deploy on `main` (banner + disable write paths) if the Pages URL must stay reachable for read-only reference.

### Branches & deploy (as of 2026-04-06)

- **`main`** — **Live site:** GitHub Pages (v1-style app + Parquet/DuckDB in browser). **Also carries** `.github/workflows/ingest-supabase.yml`, `scripts/push_duckdb_to_supabase.py`, `scripts/requirements-ci.txt`, and a synced `scripts/ingest.py` so GitHub Actions **lists** the Supabase ingest workflow (GitHub only surfaces workflows from the **default** branch). Pushing `main` still triggers **deploy-pages** — avoid merging the full v2 frontend here until intentional cutover.
- **`v2/supabase-migration`** — **Full v2 app** (React Router, Supabase adapter, Explore / Workbench / Health / Fields / Batch / History / Dashboard, migrations `001`–`029`, etc.). Deploy previews/production on **Vercel** from this branch (or another non-`main` branch) while testing. **Manual “Run workflow”** for ingest can target this branch so the job checks out v2 code.
- **Tag `pre-supabase-migration`** — Safety snapshot of main before any v2 work began.

### Migration Progress (as of 2026-04-06)

- [x] Phase 0: Branch created, data backed up to `backup/`, Supabase project created
- [x] Phase 1: SQL schema written (`supabase/migrations/001-007`), seed data written, Python migration script written
- [x] Phase 2: SQL migrations `001`–`007` + `seed.sql` applied in Supabase; `scripts/migrate_data.py` loaded `backup/` into Postgres (cards / sets / metadata / annotations verified)
- [x] Phase 3: Supabase client + `src/data/supabase/appAdapter.js` + `src/db.js` router (`VITE_USE_SUPABASE=true`); TanStack Query provider in `main.jsx`. Browse / filters / annotations + field_definitions wired; SQL console & custom card CRUD still stubbed.
- [x] Phase 4: Explore Mode — `react-router-dom` + `src/pages/ExplorePage.jsx` at `/`; TanStack Query for cards, filter options, attributes; filter prefetch / cache tuning; numeric sort for Supabase (`008` + `number_sort_key`); manual set normalization (`009`, `manual_set_normalize.py`, `normalize_custom_cards_json.py`); FilterPanel set grouping (short series slugs: owner may refine later). **Deferred (optional):** `useSearchParams` instead of ad-hoc URL sync; hide GitHub PAT / sync UI when Supabase-only; any remaining filter/sort parity.
- [x] Phase 5: Workbench Mode — `/workbench`, default queue CRUD, card image + `AnnotationEditor` + `fetchFormOptions` merged suggestions, Explore/Workbench nav, **Send to Workbench** from `CardDetail` (Supabase).
- [x] Phase 6: Supporting features — **Data Health** `/health`; **Field management** `/fields`; **Batch edit** `/batch` (saved-list wizard + review/confirm; see **`docs/plans/batch-redesign-visual-selection.md`**); **Edit history** `/history`; Workbench **Ctrl+Shift+Z** / **⌘⇧Z** undo (outside text fields); migrations **`010`**, **`011`**.

### UI feedback (Phase 4+)

When polishing Explore/Workbench, **batch UI issues** for the owner: note what screen, what you expected, what happened (screenshot optional). The best times to report are **after a Phase milestone** or when asked **“any UI regressions?”** — avoid one-off fixes mid-refactor unless something is blocking. The AI should **prompt the owner** at natural checkpoints: *“If you notice sorting, filter labels, or layout issues, list them now so we can fix them in the next pass.”* **Phase 5 checkpoint:** after the first Workbench slice lands (route + queue + one save path), ask the same for workbench-specific UX.

- [x] Phase 7: **Ingest → Supabase + Vercel** — `push_duckdb_to_supabase.py` upserts API-sourced `sets`, `cards`, `pokemon_metadata` from ingest’s DuckDB; `ingest.py --push-supabase` chains locally. **Actions:** workflow on **`main`** (so GitHub lists it) and on **`v2/supabase-migration`**; **Run workflow** can target **`v2/supabase-migration`**; weekly schedule uses **default branch**. Actions use `checkout@v5`, `setup-python@v6`, `cache@v5` (Node 24). Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; optional **`POKEMON_TCG_API_KEY`** (higher pokemontcg.io limits). **Ingest flags (CI):** **`deploy-pages.yml`** and **`ingest-supabase.yml`** run `python scripts/ingest.py --clear-failed --fail-on-partial` — clears stale `failed_sets` after API blips and **fails the job** if any ingest step skipped data (so Actions can notify); see **`docs/plans/tcg-data-refresh-coverage.md`**. **Vercel:** `vercel.json` SPA rewrites; env **`VITE_USE_SUPABASE`**, **`VITE_SUPABASE_URL`**, **`VITE_SUPABASE_ANON_KEY`** — **confirmed** in project settings (redeploy after changes). **Not done yet:** merge v2 app into `main`; production checklist below.

### Post–Phase 7 (current focus)

- [ ] E2E testing on **Vercel** (preview + production) against Supabase — manual smoke checklist: **`docs/plans/e2e-vercel-smoke-checklist.md`**.
- [ ] **Production checklist** — Anonymous auth / RLS / Vercel env (**`docs/plans/production-hardening-anon-auth.md`**).
- [ ] **Final production-readiness pass** — operator checklist + rollout order (**`docs/plans/production-readiness-final-pass.md`**). Includes staging/prod migration parity through **`028`**, Data Health RPC verification, and release gate checks.
- [ ] **Tackle-now implementation queue** — auth endpoint abuse hardening, Data Health cleanup audit trail, full manual smoke sign-off, and DuckDB/Supabase bundle-boundary optimization (Phase 4 in **`docs/plans/production-readiness-final-pass.md`**).
- [ ] **Cross-functional panel cadence** — run specialist review regularly and after major changes (**`docs/plans/cross-functional-panel-review.md`**).
- [ ] **Cutover when ready** — **`main` merge only with owner explicit go-ahead**; otherwise set Vercel production branch / env only; align GitHub Pages vs Vercel-only strategy. **Runbook:** `docs/plans/p1-cutover-and-operations.md`.
- [ ] Optional: Supabase stubs — SQL console, custom card CRUD (Phase 3 deferred items).

### Paused work & backlog (owner paused — resume anytime)

- **Public card share (shipped on v2 branch):** Read-only **`/share/card/:cardId`** (**`PublicShareCardPage`**); RPC **`get_public_card_for_share`** (**`018_public_card_share_rpc.sql`**); **`api/share-og`** + root **`middleware.js`** (crawlers → OG HTML with **`og:image`**); **`public/og-card-placeholder.svg`** when artwork missing; **Copy share link** in **`CardDetail`**. Plan: **`docs/plans/public-card-share-and-social-preview.md`**. **Tabled (not scheduled):** opaque tokens, share analytics, role-based who may copy—see plan **“Deferred — tabled”** for rationale and revisit triggers.
- **Profiles & activity (shipped on v2 branch):** **`013_profiles.sql`**, **`/profile`** + **`/profile/:userId`**, **`/dashboard`** (**Recent edits** = annotation `edit_history`; **My submitted cards** = successful manual inserts via `created_by`), **`/history`** (**Edit history** = team annotation edits, not card creation), edit history display names + “only my edits”, **`created_by`** on manual cards, **`014_storage_avatars.sql`** + Profile photo upload/remove. **Custom card form** (`CustomCardForm`): **This session — add attempts** list + **`sessionStorage`** key **`tm_custom_card_add_session_log`** for per-attempt success/error/partial (e.g. DuckDB saved, GitHub sync failed)—failed adds are **not** stored server-side; Dashboard only lists cards that reached Postgres. Spec: **`docs/plans/user-profiles-and-activity.md`**. **Apply `014` once per Supabase project** that should support avatar upload (Storage bucket + policies); skip if already applied. Recent polish: avatar error messaging now distinguishes Storage vs profiles RLS failures, and header avatar uses cache-busted URL (`updated_at`) so profile-photo changes propagate immediately across the app.
- **Batch redesign (shipped on v2 branch):** `localStorage` batch list, **Explore** checkboxes + bar + **Add all matching** (capped) + **Card detail** add/remove; **`BatchWizard`** on **`/batch`** (field → review → confirm → apply, retry failed, clear vs keep list, optional append to **`field_definitions.curated_options`** for **custom** select / multi_select). URL-scoped batch + **`BatchQuickAnnotationScope`** removed (Phase 7). Spec: **`docs/plans/batch-redesign-visual-selection.md`**.
- **Next v2 feature (approved, paused):** **User dashboards + email/password auth** (primary UX) — **`docs/plans/user-dashboards-and-password-auth.md`**.
- **Auth shipped on v2 branch (context for agents):** Invite-only sign-in — Edge Function **`request-magic-link`**, table **`signup_allowlist`**, routes **`/login`** + **`/auth/callback`**, **`VITE_REQUIRE_EMAIL_AUTH`**. Browser client uses **`flowType: 'implicit'`** in `src/lib/supabaseClient.js` so magic-link emails work when opened in a **different** browser/device than the one that requested the link.

### UI refresh (v2 branch)

- **Plan:** **`docs/plans/ui-refresh-modern-ux.md`**. **Shipped:** Phases **1–7** (shell, Explore filters, Workbench polish, power-tool cleanup, Lucide + Dialog motion + copy). **Deferred:** Card detail **IA** restructure (tabs/sections — see plan **Deferred checklist**); **Workbench queue ←/→ keyboard** (Phase 5 follow-up — **`batch-future-enhancements.md`** row **8**). **Annotator onboarding (shipped):** collapsible **About Workbench / About Batch** (**`WorkflowModeHelp.jsx`** on **`WorkbenchPage`**, **`BatchEditPage`**); Batch nav **`title`** tooltips (Explore + **`AppShellHeader`**); empty Workbench queue copy links to Explore vs Batch. **Quick custom card (Part B):** shipped in **`docs/plans/card-detail-pins-and-quick-card-add.md`** — includes **session add log** (per-attempt status, `sessionStorage`), duplicate-ID row updates, **`017`** transactional annotation saves (see edit/add hardening plan).
- **Card detail pins (Part A):** **`docs/plans/card-detail-pins-and-quick-card-add.md`** — **`user_preferences.card_detail_pins`** + **`CardDetailFieldControl`**, **`CardDetailPinEditor`**; pinned fields strip on **More Info** edit; DuckDB/localStorage fallback **`tm_card_detail_pins`**. **More pinnable keys:** extend **`CARD_DETAIL_PINNABLE_KEYS`** in **`CardDetailFieldControl.jsx`**. Apply Supabase migration **`015_card_detail_pins.sql`** on each project.
- **Custom cards + GitHub:** Decoupled for Supabase in **`CustomCardForm`** / Explore copy (see **`docs/plans/custom-card-form-supabase-github-decouple.md`**); DuckDB still optional PAT/git.
- **`unique_id` cleanup (deferred):** Legacy annotation field often duplicates **`cards.id`**. Tracked spec — **`docs/plans/unique-id-annotation-cleanup.md`** (inventory UI/DuckDB, single canonical ID, optional data migration). Not started.
- **Add/edit workflow hardening:** **`docs/plans/edit-add-card-workflow-hardening.md`** — Shipped: **version-checked** `patchAnnotations`, batch **typed count** confirm (≥25 cards), image **save confirm** when preview failed, delete/ stale-card UX, **humanizeError** tweaks, **transactional** annotation + `edit_history` via **`017_apply_annotation_with_history.sql`** / `apply_annotation_with_history`, **RPC conflict detection** (`isAnnotationVersionConflictFromRpc`: `message` / `details` / `hint` + code **`P0001`**).
- **Data Health polish (shipped on v2 branch):** graceful fallback copy when health RPCs are missing (migration guidance instead of raw function-cache errors), selected-issue **Copy deep link**, session-level **last cleanup** note + replace-mode undo prep, **View cards** render cap with **Load more**, hover preview skeleton, cleanup mode helper copy, and color semantics alignment (amber warning / slate triage / red destructive).

### Optional — after the core v2 plan is finished

Performance work is tracked in **`docs/plans/explore-supabase-performance.md`**.

- [x] **Explore filter options (RPC)** — **`020_explore_filter_options_rpc.sql`**: `get_explore_filter_options_db()` returns distincts in one round-trip; `fetchExploreFilterOptions` in `src/data/supabase/appAdapter.js` calls `supabase.rpc`, merges static lists from `annotationOptions.js`, then `mergeExploreFilterOptions`. Falls back to legacy client paging if the RPC errors. **`SECURITY INVOKER`** + `GRANT` to `authenticated` / `service_role` (no anon; aligns with **019**).
- [x] **Form options (RPC) + shared TanStack cache** — **`021_form_options_rpc.sql`**: `get_form_options_db()` returns cards / sets / `pokemon_metadata` / per-column annotation distincts in one RPC; `fetchFormOptions` builds the same shape as before via `buildFormOptionsFromRpcPayload` + `mergeAnnotationUsageIntoOptionsFromRpc`, with **`fetchFormOptionsClientPaged`** fallback. **`FORM_OPTIONS_QUERY_KEY`** in `src/db.js`; Workbench, **CardDetail**, and **CustomCardForm** use `useQuery` so options share cache (5‑min `staleTime`). Batch edit invalidates the same key after runs.
- [x] **Explore grid counts + indexes (Phase 2)** — **`022_grid_search_indexes.sql`**: `pg_trgm` GIN on `cards.name`, composite `(origin, set_id)`. `fetchCards` uses **`count: "planned"`** by default; pass **`exact_count: true`** when an exact total is required (Explore page clamp, `fetchMatchingCardIds`, etc.). See **`docs/plans/explore-supabase-performance.md`**.
- [x] **Grid + detail profile embed (Phase 3)** — **`023_cards_annotations_profiles_fk.sql`** (**must be applied** on each Supabase env or embeds fail): `created_by` / `updated_by` FK → **`profiles`**. **`fetchCard`** embeds **`profiles!…_fkey(display_name)`** (card detail attribution). **`fetchCards`** (Explore grid) omits profile embeds to avoid PostgREST edge cases; tile-level creator/editor names deferred. **`annotationRowToFlat`** drops embed **`profiles`**. Explore uses **`exact_count: true`** + page clamp vs URL `?page=` (see `ExplorePage.jsx`).
- [x] **Card detail path (Phase 4)** — **`fetchCard`**: skip **`pokemon_metadata`** for Pocket (`tcgdex`). **`CardDetail.jsx`**: card load via **`useQuery`** `['cardDetail', cardId, source]` + **`setQueryData`** / **`invalidateQueries`** for saves and tab visibility (see **`docs/plans/explore-supabase-performance.md`**).
- [x] **Startup prefetch (Phase 5)** — **`main.jsx`**: after **`setReady(true)`**, Explore **`fetchExploreFilterOptions`** prefetch runs via **`requestIdleCallback`** (fallback double **`requestAnimationFrame`**), same **`queryKey`** as **`ExplorePage`** for dedupe.
- [x] **Verification & rollback (Phase 6)** — Runbook + checklist in **`docs/plans/explore-supabase-performance.md`**; optional **`VITE_USE_FILTER_OPTIONS_RPC=false`** forces legacy client-paged Explore filter options (**`appAdapter.js`**); cross-link in **`docs/plans/e2e-vercel-smoke-checklist.md`**. Owner items: RLS smoke + v1/v2 sign-off remain manual.

### Before finishing the v2 plan (production checklist)

- [ ] **Anonymous auth & RLS** — Apply **`019_rls_exclude_anonymous_sessions.sql`**; turn off **Anonymous** provider in Supabase for production; set **`VITE_SUPABASE_AUTO_ANON_AUTH`** off/unset on Vercel; use **`VITE_REQUIRE_EMAIL_AUTH=true`** for invite/email-only access. Step-by-step: **`docs/plans/production-hardening-anon-auth.md`**.

## V1 Architecture (current live site on `main`)

- **Frontend:** React 19 + Vite + Tailwind CSS 4
- **Data:** DuckDB-WASM loads Parquet files in-browser. Annotations/custom cards stored in IndexedDB + JSON files committed to git.
- **Sync:** GitHub PAT-based sync — custom cards push to repo as JSON commits, triggering CI rebuild.
- **Deploy:** GitHub Pages via `.github/workflows/deploy-pages.yml`
- **Ingest:** Weekly GitHub Action runs `scripts/ingest.py` → fetches from Pokemon TCG API, PokeAPI, TCGdex → exports to Parquet → commits to repo.

### V1 Known Problems

- Data scattered across 5+ locations (Parquet, JSON, IndexedDB, git, DuckDB-WASM in-memory)
- 33MB+ binary files committed to git
- PAT-based sync is fragile, requires technical knowledge
- No concurrent edit protection
- Double-prefix bug on custom card IDs (`custom-custom-...`)
- No data normalization ("Pokemon" vs "pokemon" vs "Pokémon" all stored differently)
- Monolithic components: `db.js` (3000 lines), `CardDetail.jsx` (76KB), `App.jsx` (41KB)
- No routing, no form library, no state management beyond useState

## V2 Architecture (being built on `v2/supabase-migration`)

### Stack

- **Frontend:** React + React Router + TanStack Query + React Hook Form + Tailwind
- **Backend:** Supabase (Postgres + Auth + RLS) — free tier
- **Auth:** **Email + password** (primary UX on v2: **`LoginPage`**, Edge Function **`invite-set-password`**) plus **magic-link** recovery path where still wired; **production:** invite-only via allowlist + secrets + **`VITE_REQUIRE_EMAIL_AUTH`**; client may use **`flowType: 'implicit'`** for cross-device magic links when that path is enabled (see **`docs/plans/user-dashboards-and-password-auth.md`** and profiles plan).
- **Deploy:** Vercel (free tier) — preview deploys per branch
- **Ingest:** Weekly `ingest-supabase` workflow (or `ingest.py` locally) refreshes DuckDB, then `push_duckdb_to_supabase.py` upserts API rows into Postgres. `main` branch may still use Pages workflow + Parquet until cutover.

### Database Schema (Supabase/Postgres)

**`cards`** — unified table (replaces tcg_cards + pocket_cards + custom cards):
- All cards in one table regardless of source
- `origin` TEXT: 'pokemontcg.io', 'tcgdex', 'manual' (CHECK constraint)
- `origin_detail` TEXT: 'Japan Exclusive', 'Carddass', etc. (for manual cards)
- `format` TEXT: 'printed', 'digital', 'promotional' (CHECK constraint)
- `last_seen_in_api` TIMESTAMPTZ: ingest never deletes, tracks staleness
- No `is_custom`, no `custom-` ID prefix, no `_table` field, no `source` field

**`sets`** — unified (replaces sets + pocket_sets + custom_sets)

**`pokemon_metadata`** — species data from PokeAPI

**`annotations`** — one row per annotated card:
- ~30 known fields as typed columns (art_style JSONB[], pose JSONB[], emotion JSONB[], etc.)
- `extra` JSONB: dynamic fields created via Field Management UI
- `overrides` JSONB: user edits to API-sourced card fields
- `version` INT: optimistic locking
- FK to cards.id with ON DELETE CASCADE

**`field_definitions`** — drives dynamic form rendering (name, label, field_type, category, curated_options)

**`normalization_rules`** — value normalization (match_pattern → replace_with), applied in app layer + nightly pg_cron safety net

**`edit_history`** — audit trail, partitioned by quarter; **`edited_by`** → `auth.users(id)` (no FK on `card_id` so history survives card deletion). Table Editor shows the parent table plus partition tables (e.g. `edit_history_2026_q1`, …). App should log **`edited_by`** on writes (see `appAdapter.js`).

**`signup_allowlist`** — emails allowed to request a magic link via Edge Function (`012_signup_allowlist.sql`). RLS on; no user-facing policies — service role only.

**`health_check_results`** — rows for automated / scheduled health checks (optional; Data Health UI can list recent rows).

**`user_preferences`** — per-user UI config: **`quick_fields`** (JSONB, legacy default list), **`card_detail_pins`** (JSONB array of field keys — ordered pins for Explore **Card detail** edit mode; migration **`015`**); **`default_category`**

**`workbench_queues`** — persistent annotation queues per user

**`profiles`** — one row per `auth.users`: `display_name`, optional `avatar_url` (public URL after Storage upload); RLS: authenticated read all, write own. Trigger on `auth.users` insert. Migrations **`013_profiles.sql`**, **`014_storage_avatars.sql`** (Storage bucket **`avatars`**, per-user object prefix).

### Key Design Decisions

1. **Unified cards table** — "custom" cards are just real cards from sources the API doesn't cover. One table, `origin` column tracks provenance.
2. **Hybrid typed columns + JSONB** for annotations — known fields as columns, `extra` JSONB for dynamic fields. No automatic promotion — developer runs ALTER TABLE manually (~2x/year).
3. **Overrides merged in application layer** — `{ ...card, ...annotation.overrides }`, not in SQL views.
4. **Server-side ID generation** — Postgres function, users never type IDs. Format: `{set_id}-{normalized_number}`.
5. **Ingest never deletes** — UPSERT scoped by `WHERE origin = EXCLUDED.origin`. Manual entries are protected.
6. **Normalization in app layer** — React form onSubmit applies rules (user sees changes). Nightly pg_cron cleanup as safety net.
7. **`set_name`/`set_series`/`evolution_line` kept denormalized** — immutable/static data, JOIN is wasted work.

### UI Architecture: Two-View Design

**Explore Mode** — browse, filter, discover:
- Card grid with visual completion indicators (green/yellow/gray)
- Search + filters
- Read-only card detail panel
- "Send to Workbench" action; **Batch** nav may include current `location.search` for convenience; **`/batch`** applies to the **saved batch list** from Explore (not URL scope)

**Workbench Mode** — edit, annotate, add cards:
- Split-pane: card image (left) + annotation form (right)
- Queue system: process cards sequentially, persists across sessions
- Configurable fields per queue (focused annotation passes)
- Keyboard-first: Tab between fields, Ctrl+arrows for card nav, type-to-filter dropdowns
- Auto-save with inline feedback
- "Create & Add Another" for bulk card entry
- Session undo stack (Ctrl+Z)

### Fields Pending User Decision

These fields need the project owner to decide before they're included or excluded:
- `color` — is it species color (from pokemon_metadata) or card artwork color? If species → remove, if artwork → rename to `card_color`
- `shape` — same: species body shape or visual emphasis in card art?
- `location` — stale copy of encounter_location, or the location depicted in card art? (already have `card_locations`)
- `primary_color`, `secondary_color`, `card_region`, `storytelling` — exist in schema but may never have been displayed in UI. Planned features or dead weight?

## File Structure (v2 branch)

```
supabase/
  migrations/
    001_create_cards.sql         -- cards, sets, pokemon_metadata, ID functions
    002_create_annotations.sql   -- annotations with all typed columns + JSONB
    003_create_field_definitions.sql
    004_create_edit_history.sql  -- partitioned by quarter
    005_create_normalization_rules.sql + health_check_results
    006_create_user_preferences.sql + workbench_queues
    007_create_rls_policies.sql  -- all tables locked, authenticated only
    008_cards_number_sort_key.sql
    009_fix_manual_set_ids_and_labels.sql
    010_field_definitions_number_type.sql  -- allow field_type = number for custom fields
    011_field_definitions_rls_custom_only_writes.sql  -- INSERT/UPDATE/DELETE only category = custom
    012_signup_allowlist.sql       -- invite-only email gate for request-magic-link Edge Function
    013_profiles.sql               -- profiles, RLS, auth trigger, indexes for history/cards
    014_storage_avatars.sql        -- Storage bucket `avatars` + RLS for per-user paths
    015_card_detail_pins.sql       -- `user_preferences.card_detail_pins` JSONB for Explore card detail
    016_generate_card_id_manual.sql
    017_apply_annotation_with_history.sql  -- RPC: annotation + `edit_history` in one transaction
    018_public_card_share_rpc.sql            -- `get_public_card_for_share` for anonymous share + OG
    019_rls_exclude_anonymous_sessions.sql   -- RLS: real members only (JWT is_anonymous); share RPC unchanged
    020_explore_filter_options_rpc.sql       -- `get_explore_filter_options_db`: Explore filter distincts in one RPC
    021_form_options_rpc.sql                 -- `get_form_options_db`: form combobox distincts (Workbench / detail / custom form)
    022_grid_search_indexes.sql              -- pg_trgm + indexes for Explore grid / name search
    023_cards_annotations_profiles_fk.sql    -- FK → profiles for PostgREST embed (no extra profile query)
    024_batch_selections.sql                 -- per-user Batch list sync (Explore selection bar)
    025_batch_runs_edit_history.sql         -- batch_runs + edit_history.batch_run_id; RPC p_batch_run_id
    025b_manual_card_dedupe_preflight_rpc.sql -- RPC `get_manual_card_dedupe_preflight` (read-only; run before 026)
    026_manual_card_id_cleanup.sql          -- dedupe legacy manual card ids; rewire refs; CHECK no whitespace in cards.id
    027_manual_card_id_health_check.sql    -- read-only Data Health RPC for non-canonical manual card IDs
    028_annotation_value_issues_and_cleanup_rpc.sql -- Data Health value issue triage + view cards + bulk replace/remove RPCs
    029_fix_annotation_value_cleanup_rpc.sql -- fixes runtime SQL error in apply_annotation_value_cleanup (target alias in LATERAL)
  config.toml                    -- Edge Functions: verify_jwt = false for request-magic-link
  functions/                     -- request-magic-link (invite + allowlist → signInWithOtp)
  seed.sql                       -- field_definitions + normalization_rules

scripts/
  ingest.py                      -- DuckDB ingest; `--push-supabase` → push to Postgres; **`--clear-failed`**, **`--fail-on-partial`** (CI alerting)
  push_duckdb_to_supabase.py     -- upsert API-sourced rows from DuckDB → Supabase
  requirements-ci.txt            -- duckdb + httpx + postgrest (Actions ingest job)
  migrate_data.py                -- one-time migration: backup/ → Supabase
  manual_set_normalize.py        -- custom card set_id / set_name normalization
  normalize_custom_cards_json.py -- rewrite custom_cards.json with same rules
  strip_custom_card_ids.py       -- strip/normalize whitespace in `id` fields before `migrate_data.py`
  export_parquet.py              -- TO BE DELETED (no longer needed)

backup/                          -- gitignored, contains pre-migration data snapshots
  cards.csv, sets.csv, pocket_cards.csv, pocket_sets.csv,
  pokemon_metadata.csv, custom_cards.json, annotations.json

src/                             -- React frontend (v2 routes + Supabase layer on v2 branch)
  main.jsx                       -- QueryClient + router root; Sonner **`Toaster`**; DB init prefetch
  App.jsx                        -- router shell: nested **`Protected`** + **`AppLayout`** (optional **`VITE_EXPERIMENTAL_NAV`**), auth routes
  layouts/AppLayout.jsx          -- optional **`AppShellHeader`** + **`<Outlet />`**
  components/AppShellHeader.jsx  -- experimental canopy nav (Explore, Workbench, Activity, Manage data)
  lib/toast.js                   -- **`toastSuccess` / `toastError`** (Phase 2)
  lib/humanizeError.js           -- plain-English **`toastError`** copy from API/network errors
  lib/navEnv.js                  -- **`useExperimentalAppNav()`** (`VITE_EXPERIMENTAL_NAV`)
  lib/useMediaQuery.js           -- breakpoint hook (Explore **`FilterPanel`** sheet)
  lib/exploreFilterSummary.js    -- **`exploreFiltersAreActive`**, **`exploreHasActiveConstraints`**
  components/ui/Dialog.jsx       -- Radix **`Dialog`** wrapper (mobile Explore filters)
  components/ui/FormFieldLabel.jsx -- two-line labels (uses **`splitUiLabel`**)
  lib/splitUiLabel.js            -- split primary vs. parenthetical for field labels
  components/FilterPanel.jsx     -- Explore filters + sort (Phase 4 summary, **More filters**, mobile dialog)
  pages/ExplorePage.jsx          -- Explore route: grid, filters, detail
  components/CardDetailFieldControl.jsx  -- shared editors for **Card detail** pins + form (pinnable keys)
  components/CardDetailPinEditor.jsx     -- modal: ordered **Edit pins** (`user_preferences.card_detail_pins`)
  pages/WorkbenchPage.jsx        -- Workbench queue + **split width presets** (`tm_workbench_split_preset`) + save chrome
  pages/DashboardPage.jsx        -- personal dashboard (**Recent edits** vs **My submitted cards** copy; `fetchMyEditHistory` / `fetchMyCards`)
  pages/BatchEditPage.jsx        -- **`BatchWizard`** (saved list); **`WorkflowModeHelp`** when list empty — **`docs/plans/batch-redesign-visual-selection.md`**
  components/BatchWizard.jsx            -- field → review → confirm → apply (saved `localStorage` ids)
  components/WorkflowModeHelp.jsx       -- collapsible onboarding (Workbench / Batch)
  pages/PublicShareCardPage.jsx  -- read-only **`/share/card/:id`** (outside **`Protected`**)
  pages/ProfilePage.jsx          -- edit own profile / view teammate (display name + avatar)
  pages/EditHistoryPage.jsx      -- team annotation edit history + “only my edits” (not custom card creation)
  components/CustomCardForm.jsx  -- custom card add; **session add log** + `tm_custom_card_add_session_log`; Quick/Full, Workbench handoff
  db.js                          -- routes DuckDB vs Supabase (`data/supabase/appAdapter.js`)
  lib/github.js                  -- WILL BE DELETED
  lib/annotationOptions.js       -- WILL BE REPLACED by field_definitions table
  components/                    -- WILL BE decomposed into Explore/ and Workbench/ dirs

package.json                   -- `npm run dev` / `build`; **`check:quick`**, **`check`**, **`test:e2e`** (see **Site checks** + **`docs/site-checks.md`**)
playwright.config.mjs          -- Playwright smoke: `vite preview` on **127.0.0.1:5174** (not the dev default **5173**)
tests/e2e/smoke.spec.js        -- minimal Explore + Batch smoke (DuckDB mode)

.env.local                       -- gitignored, contains VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
.env.example                     -- template for .env.local
vercel.json                      -- Vite SPA rewrites for Vercel; cleanUrls false for /login deep links
middleware.js                    -- Edge: social/crawler User-Agents → `/api/share-og` for Open Graph
api/share-og.js                  -- Serverless HTML + `og:image` for link previews
public/og-card-placeholder.svg   -- Default preview when card has no image URL
docs/plans/user-profiles-and-activity.md  -- profiles / dashboard / avatars (see plan status)
docs/plans/user-dashboards-and-password-auth.md  -- password-primary auth + dashboard (cross-ref profiles)
docs/plans/p1-cutover-and-operations.md  -- cutover runbook (Vercel / merge / migrations reminder; merge to `main` only on owner say-so)
docs/site-checks.md  -- local `npm run check` / `check:quick` + Playwright vs Vercel smoke
docs/plans/e2e-vercel-smoke-checklist.md  -- manual QA after deploy (Supabase + Vercel)
docs/plans/production-hardening-anon-auth.md  -- production: migration 019 + disable anon + Vercel env
docs/plans/production-readiness-final-pass.md  -- final release gate checklist (migration parity, hardening, smoke, Data Health verification)
docs/plans/cross-functional-panel-review.md  -- recurring multi-role review findings + reminder cadence after major edits/features
docs/plans/sync-main-public-data-to-supabase.md  -- merge `public/data` from `main` + push DuckDB/custom cards to Supabase
docs/ai-agent-merge-policy.md  -- never merge to `main` without owner (cross-ref CLAUDE Conventions)
docs/plans/custom-card-form-supabase-github-decouple.md  -- Custom cards: Supabase-only UX (no PAT)
docs/plans/unique-id-annotation-cleanup.md  -- Deferred: dedupe legacy `annotations.unique_id` vs `cards.id`
docs/plans/batch-redesign-visual-selection.md  -- visual batch list + wizard + optional curated append (shipped on v2 branch)
docs/plans/batch-future-enhancements.md  -- backlog (batch + release follow-ups: Playwright/CI smoke, invite lookup scalability, migration naming hygiene, OG host hardening, Workbench queue nav)
docs/plans/tcg-data-refresh-coverage.md  -- ingest verification, `failed_sets`, CI ingest flags
docs/plans/edit-add-card-workflow-hardening.md  -- add/edit card UX + concurrency + batch safety (shipped phases); see also batch redesign plan
docs/plans/ui-refresh-modern-ux.md  -- Modern UI/UX: shell, toasts, filters, tokens (phased)
docs/plans/card-detail-pins-and-quick-card-add.md  -- Card detail **pins** (Part A) + **quick custom card** (Part B)
docs/plans/public-card-share-and-social-preview.md  -- Public `/share/card/…` + Open Graph thumbnails (**shipped**)
.github/workflows/site-checks.yml  -- push/PR: `npm run check:quick` (build + unit tests)
.github/workflows/ingest-supabase.yml  -- weekly ingest + push to Supabase
```

## Site checks (local)

- **`npm run check:quick`** — production build + Node unit tests (fast, no browser).
- **`npm run check`** — **`check:quick`** + Playwright smoke (DuckDB preview; see `playwright.config.mjs`).
- **Hosted v2 / Supabase** is not exercised by Playwright here; use **`docs/plans/e2e-vercel-smoke-checklist.md`** after deploy.

Full write-up: **`docs/site-checks.md`**.

## Conventions

- Do NOT include `Co-Authored-By` lines in commit messages
- **Default:** do not change **`main`** frontend / Pages-facing app except **live bugfixes** for the current GitHub Pages site.
- **Exception:** sync **ingest-only** CI files to `main` (workflow + `push_duckdb_to_supabase.py` + `requirements-ci.txt` + `ingest.py`) when needed so Actions lists **Ingest and push to Supabase**; expect an extra Pages deploy on each such push.
- All **v2 product work** on **`v2/supabase-migration`**. **Merging into `main`** (cutover) happens **only when the owner explicitly says to** — not on agent initiative. See **`docs/ai-agent-merge-policy.md`** (and **`.cursor/rules/merge-main-owner-only.mdc`** if present locally).
- Secret key (SUPABASE_SERVICE_KEY) is NEVER stored in any file — passed as env var only
- Backup directory is gitignored — safety net data lives only locally

## AI agents (Cursor / assistants)

When asking the user for **permission** before doing something (destructive edits, `git push`, installing packages, broad refactors, scope changes, etc.), always pair the ask with a **brief plain-English summary** of the intended actions—what files or systems will be touched and what will happen. Do not only ask “Should I proceed?” without stating *what* will be done, so the owner can decide without inferring intent.

**Never merge to `main` or open a PR that merges into `main`** unless the owner **explicitly** requests that merge in the conversation. Pushes to **`v2/supabase-migration`** are fine when asked. Policy: **`docs/ai-agent-merge-policy.md`**.

After major feature work, migrations, auth/session changes, or pre-release milestones, agents should prompt for a **cross-functional panel review** and use **`docs/plans/cross-functional-panel-review.md`** as the checklist baseline.

## Memory System

**In-repo (preferred for AI agents in Cursor):** phased plans and resume context live under **`docs/plans/`** (e.g. **`user-profiles-and-activity.md`**). **`CLAUDE.md`** is the primary project snapshot; keep it updated when phases complete or backlog changes.

**External (optional):** detailed conversation history may also live under:
`/Users/keifergonzalez/.claude/projects/-Users-keifergonzalez-Documents-Coding-Pokemon-Tropius-Maximus/memory/`

Key files there:
- `project_v2_migration.md` — full migration plan with schema, UI architecture, build order (if out of date vs `CLAUDE.md`, prefer repo + this file)
- `project_current_pain_points.md` — all known v1 bugs and issues
- `feedback_architecture.md` — architecture decisions, DBA corrections, UX requirements
- `user_profile.md` — project owner info and collaboration preferences
