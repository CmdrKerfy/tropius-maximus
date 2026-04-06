# Tropius Maximus — Project Context

## What This Is

Pokemon TCG database and collection tracker. 15,000+ cards from multiple APIs, with 50+ annotation fields for cataloging card artwork, themes, and metadata. Used by 1-3 people (2 non-technical).

## Current State: Mid-Migration (v2)

The project is actively being migrated from v1 (GitHub Pages + DuckDB-WASM) to v2 (Supabase + Vercel). **Both versions coexist in the repo on different branches.**

### Branches

- **`main`** — Current live site. GitHub Pages deployment. DO NOT modify unless fixing a live bug.
- **`v2/supabase-migration`** — New version. All v2 work happens here. This is the active development branch.
- **Tag `pre-supabase-migration`** — Safety snapshot of main before any v2 work began.

### Migration Progress (as of 2026-04-05)

- [x] Phase 0: Branch created, data backed up to `backup/`, Supabase project created
- [x] Phase 1: SQL schema written (`supabase/migrations/001-007`), seed data written, Python migration script written
- [x] Phase 2: SQL migrations `001`–`007` + `seed.sql` applied in Supabase; `scripts/migrate_data.py` loaded `backup/` into Postgres (cards / sets / metadata / annotations verified)
- [x] Phase 3: Supabase client + `src/data/supabase/appAdapter.js` + `src/db.js` router (`VITE_USE_SUPABASE=true`); TanStack Query provider in `main.jsx`. Browse / filters / annotations + field_definitions wired; SQL console & custom card CRUD still stubbed.
- [x] Phase 4: Explore Mode — `react-router-dom` + `src/pages/ExplorePage.jsx` at `/`; TanStack Query for cards, filter options, attributes; filter prefetch / cache tuning; numeric sort for Supabase (`008` + `number_sort_key`); manual set normalization (`009`, `manual_set_normalize.py`, `normalize_custom_cards_json.py`); FilterPanel set grouping (short series slugs: owner may refine later). **Deferred (optional):** `useSearchParams` instead of ad-hoc URL sync; hide GitHub PAT / sync UI when Supabase-only; any remaining filter/sort parity.
- [x] Phase 5: Workbench Mode — `/workbench`, default queue CRUD, card image + `AnnotationEditor` + `fetchFormOptions` merged suggestions, Explore/Workbench nav, **Send to Workbench** from `CardDetail` (Supabase).
- [x] Phase 6: Supporting features — **Data Health** `/health`; **Field management** `/fields`; **Batch edit** `/batch`; **Edit history** `/history`; Workbench **Ctrl+Shift+Z** / **⌘⇧Z** undo (outside text fields); migrations **`010`**, **`011`**.

### UI feedback (Phase 4+)

When polishing Explore/Workbench, **batch UI issues** for the owner: note what screen, what you expected, what happened (screenshot optional). The best times to report are **after a Phase milestone** or when asked **“any UI regressions?”** — avoid one-off fixes mid-refactor unless something is blocking. The AI should **prompt the owner** at natural checkpoints: *“If you notice sorting, filter labels, or layout issues, list them now so we can fix them in the next pass.”* **Phase 5 checkpoint:** after the first Workbench slice lands (route + queue + one save path), ask the same for workbench-specific UX.

- [x] Phase 7: **Ingest → Supabase** — `scripts/push_duckdb_to_supabase.py` upserts `sets`, `cards` (API origins only), `pokemon_metadata` from `public/data/pokemon.duckdb`; `ingest.py --push-supabase` runs it after ingest. CI: `.github/workflows/ingest-supabase.yml` (weekly + manual; needs repo secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`). Deps: `scripts/requirements-ci.txt`. **Vercel** — connect the GitHub repo, set `VITE_USE_SUPABASE=true`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BASE=/` (or leave default `/` for apex domain); `vercel.json` enables SPA fallback for React Router. Production: follow checklist below (Anonymous auth off, etc.).

### Optional — after the core v2 plan is finished

Do **not** bundle this into Phases 1–2 or the main migration sequence; it is a performance pass when Explore feels slow loading filter dropdowns.

- [ ] **Server-side filter options** — Today `fetchFilterOptions` in `src/data/supabase/appAdapter.js` builds distinct values by paging through `cards` / `annotations` in the client. Replace with a Postgres RPC (e.g. `get_filter_options(p_source text) RETURNS jsonb`) that runs `SELECT DISTINCT` (and existing `sets` / `pokemon_metadata` queries) in one round-trip; call it from `appAdapter.js` via `supabase.rpc`. Align `SECURITY`/RLS/`GRANT EXECUTE` with current policies. Add indexes on `(origin, …)` only if profiling shows they help.

### Before finishing the v2 plan (production checklist)

- [ ] **Turn off Supabase Anonymous sign-in** (Authentication → Providers → Anonymous) **or** replace it with real auth (magic links per stack above) **and** tighten RLS so anonymous/guest access is not equivalent to full member access on a public URL. Anonymous is fine for **local Phase 3 testing** only; **do not ship production** with Anonymous left on unless RLS explicitly accounts for it.
- [ ] Remove or set `VITE_SUPABASE_AUTO_ANON_AUTH=false` in production/Vercel env; do not rely on auto anonymous login in the live app unless that is an intentional product decision.

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
- **Auth:** Magic links (email-based, no passwords or PATs)
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

**`edit_history`** — audit trail, partitioned by quarter, no FK (survives card deletion)

**`user_preferences`** — per-user quick fields config

**`workbench_queues`** — persistent annotation queues per user

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
- "Send to Workbench" action

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
  seed.sql                       -- field_definitions + normalization_rules

scripts/
  ingest.py                      -- DuckDB ingest; `--push-supabase` → push to Postgres
  push_duckdb_to_supabase.py     -- upsert API-sourced rows from DuckDB → Supabase
  requirements-ci.txt            -- duckdb + httpx + postgrest (Actions ingest job)
  migrate_data.py                -- one-time migration: backup/ → Supabase
  manual_set_normalize.py        -- custom card set_id / set_name normalization
  normalize_custom_cards_json.py -- rewrite custom_cards.json with same rules
  export_parquet.py              -- TO BE DELETED (no longer needed)

backup/                          -- gitignored, contains pre-migration data snapshots
  cards.csv, sets.csv, pocket_cards.csv, pocket_sets.csv,
  pokemon_metadata.csv, custom_cards.json, annotations.json

src/                             -- React frontend (to be rewritten in phases 3-6)
  App.jsx                        -- router shell (Phase 4+)
  pages/ExplorePage.jsx          -- Explore route: grid, filters, detail
  pages/WorkbenchPage.jsx        -- Workbench route (Phase 5 shell)
  db.js                          -- routes DuckDB vs Supabase (`data/supabase/appAdapter.js`)
  lib/github.js                  -- WILL BE DELETED
  lib/annotationOptions.js       -- WILL BE REPLACED by field_definitions table
  components/                    -- WILL BE decomposed into Explore/ and Workbench/ dirs

.env.local                       -- gitignored, contains VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
.env.example                     -- template for .env.local
vercel.json                      -- Vite SPA rewrites for Vercel (Phase 7)
.github/workflows/ingest-supabase.yml  -- weekly ingest + push to Supabase
```

## Conventions

- Do NOT include `Co-Authored-By` lines in commit messages
- Do NOT modify the `main` branch unless fixing a live bug on the current site
- All v2 work on `v2/supabase-migration` branch
- Secret key (SUPABASE_SERVICE_KEY) is NEVER stored in any file — passed as env var only
- Backup directory is gitignored — safety net data lives only locally

## AI agents (Cursor / assistants)

When asking the user for **permission** before doing something (destructive edits, `git push`, installing packages, broad refactors, scope changes, etc.), always pair the ask with a **brief plain-English summary** of the intended actions—what files or systems will be touched and what will happen. Do not only ask “Should I proceed?” without stating *what* will be done, so the owner can decide without inferring intent.

## Memory System

Detailed conversation history, architecture decisions, and feedback are stored in:
`/Users/keifergonzalez/.claude/projects/-Users-keifergonzalez-Documents-Coding-Pokemon-Tropius-Maximus/memory/`

Key files:
- `project_v2_migration.md` — full migration plan with schema, UI architecture, build order
- `project_current_pain_points.md` — all known v1 bugs and issues
- `feedback_architecture.md` — architecture decisions, DBA corrections, UX requirements
- `user_profile.md` — project owner info and collaboration preferences
