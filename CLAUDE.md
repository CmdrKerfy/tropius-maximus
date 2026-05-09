# Tropius Maximus — Project Context

## What This Is

Pokemon TCG database and collection tracker. 15,000+ cards from multiple APIs, with 50+ annotation fields for cataloging card artwork, themes, and metadata. Used by 1-3 people (2 non-technical).

## Current State: Mid-Migration (v2) — deploy testing; cutover not merged

The project is actively being migrated from v1 (GitHub Pages + DuckDB-WASM) to v2 (Supabase + Vercel). **Both versions coexist in the repo on different branches.**

**Owner decision (ongoing):** Keep **GitHub Pages (v1)** and **Vercel (v2)** **separate** for now—no merge to `main` required for two live URLs. **Freeze the old site for submissions** so users do not add custom cards or annotations on v1 by mistake; canonical editing is **Vercel v2** only.

### Branches & deploy

- **`main`** — GitHub Pages (v1). Also carries ingest workflow files so GitHub Actions lists them.
- **`v2/supabase-migration`** — Full v2 app. Deployed on **Vercel** (preview + production).
- **Tag `pre-supabase-migration`** — Safety snapshot of main before v2 work began.

### Migration Progress

Phases 0–7 complete: schema, data migration, Supabase adapter, Explore/Workbench/Batch/Health/Fields/History/Dashboard, ingest pipeline, Vercel deploy. All core features shipped on v2 branch.

**Completed since Phase 7:**
- PTCG-database Japanese card ingest (`origin='ptcgdb'`, migrations 049–052)
- Bundle performance optimization (993KB → 350KB main chunk)
- Explore filter options materialized view (054): <50ms instead of 4-8s client-paged cascade
- CardGrid visual fix (reverted unnecessary virtualization, kept CSS grid + React.memo)

**Pending:**
- [ ] E2E testing on Vercel — manual smoke checklist: `docs/plans/e2e-vercel-smoke-checklist.md`
- [ ] Production checklist — Anonymous auth / RLS / Vercel env (`docs/plans/production-hardening-anon-auth.md`)
- [ ] Final production-readiness pass (`docs/plans/production-readiness-final-pass.md`)
- [ ] Auth endpoint abuse hardening, Data Health cleanup audit trail
- [ ] Phase 6 shared-list QA sign-off
- [ ] Cutover when ready — `main` merge only with owner explicit go-ahead. Runbook: `docs/plans/p1-cutover-and-operations.md`

### Shipped features (documented for context)

Auth: invite-only magic-link sign-in (`signup_allowlist`, Edge Function `request-magic-link`, `VITE_REQUIRE_EMAIL_AUTH`). Profiles + avatars (013, 014). Public card share (`/share/card/:id`, OG previews, 018). Batch redesign (visual selection + wizard). Card detail pins (015). Workbench shared lists + owner controls (035–038). Camera angle multi-select (044). Data Health polish + cleanup RPCs (028–029). Background details normalization (030–032). Workflow hardening: version-checked saves, transactional annotation + edit_history (017), RPC conflict detection.

**Paused (approved, resume anytime):** User dashboards + email/password auth — `docs/plans/user-dashboards-and-password-auth.md`.

**Deferred:** Card detail IA restructure; Workbench queue keyboard nav; `unique_id` annotation cleanup (`docs/plans/unique-id-annotation-cleanup.md`).

## V1 Architecture (current live site on `main`)

- **Frontend:** React 19 + Vite + Tailwind CSS 4
- **Data:** DuckDB-WASM loads Parquet files in-browser. Annotations/custom cards in IndexedDB + JSON committed to git.
- **Sync:** GitHub PAT-based sync — custom cards push to repo as JSON commits.
- **Deploy:** GitHub Pages via `.github/workflows/deploy-pages.yml`
- **Ingest:** Weekly GitHub Action → Pokemon TCG API, PokeAPI, TCGdex → Parquet → git commit.

### V1 Known Problems

- Data scattered across Parquet, JSON, IndexedDB, git, DuckDB-WASM in-memory
- 33MB+ binary files committed to git; PAT-based sync is fragile
- No concurrent edit protection, no routing, no form library
- Monolithic components: `db.js` (3000 lines), `CardDetail.jsx` (76KB), `App.jsx` (41KB)

## V2 Architecture

### Stack

- **Frontend:** React + React Router + TanStack Query + React Hook Form + Tailwind
- **Backend:** Supabase (Postgres + Auth + RLS) — free tier
- **Auth:** invite-only magic-link; browser client uses `flowType: 'implicit'` for cross-device links
- **Deploy:** Vercel (free tier) — preview deploys per branch
- **Ingest:** Weekly `ingest-supabase` workflow refreshes DuckDB, then `push_duckdb_to_supabase.py` upserts into Postgres and refreshes the `explore_filter_options` materialized view

### Database Schema (Supabase/Postgres)

**`cards`** — unified table. `origin` TEXT: 'pokemontcg.io', 'tcgdex', 'ptcgdb', 'manual'. `origin_detail` for Japanese/Carddass/etc. `format`: 'printed', 'digital', 'promotional'. `last_seen_in_api` tracks staleness (ingest never deletes).

**`sets`** — unified across all origins.

**`pokemon_metadata`** — species data from PokeAPI.

**`annotations`** — one row per card: ~30 typed columns (art_style JSONB[], pose JSONB[], etc.), `extra` JSONB for dynamic fields, `overrides` JSONB for user edits to API fields, `version` INT for optimistic locking. FK to cards.id ON DELETE CASCADE.

**`field_definitions`** — drives dynamic form rendering (name, label, field_type, category, curated_options).

**`edit_history`** — audit trail, partitioned by quarter. `edited_by` → auth.users(id).

**`user_preferences`** — per-user config: `quick_fields`, `card_detail_pins` (015), `workbench_pins` (039), `default_category`.

**`workbench_queues`** — persistent annotation queues per user.

**`profiles`** — `display_name`, `avatar_url` (Storage bucket `avatars`). Trigger on `auth.users` insert. Migrations 013, 014.

### Key Design Decisions

1. **Unified cards table** — origin column tracks provenance, no "custom" prefix or separate tables.
2. **Hybrid typed columns + JSONB** for annotations — known fields as columns, `extra` JSONB for dynamic fields.
3. **Overrides merged in app layer** — `{ ...card, ...annotation.overrides }`, not SQL views.
4. **Server-side ID generation** — Postgres function, format: `{set_id}-{normalized_number}`.
5. **Ingest never deletes** — UPSERT scoped by `WHERE origin = EXCLUDED.origin`. Manual entries protected.
6. **Normalization in app layer** — React form onSubmit applies rules. Nightly pg_cron as safety net.
7. **Denormalized set_name/set_series/evolution_line** — immutable data, JOIN is wasted work.

### UI Architecture: Two-View Design

**Explore Mode** — browse, filter, discover: card grid + search + filters + read-only detail panel. "Send to Workbench" action. Batch nav uses saved `localStorage` list, not URL scope.

**Workbench Mode** — edit, annotate, add cards: split-pane image + annotation form, persistent queue, keyboard-first nav, auto-save.

### Fields Pending User Decision

- `color` — species color (pokemon_metadata) or card artwork color? If artwork → rename to `card_color`.
- `shape` — species body shape or visual emphasis in card art?
- `location` — stale encounter_location or location depicted in card art?
- `primary_color`, `secondary_color`, `card_region`, `storytelling` — planned or dead weight?

## File Structure (v2 branch)

```
supabase/
  migrations/
    001-007   core schema (cards, sets, annotations, field_definitions, edit_history, RLS, etc.)
    008-011   number sort, manual set fixes, field_definitions extensions
    012       signup_allowlist (invite gate)
    013-014   profiles + storage avatars
    015       card_detail_pins
    016-018   manual card ID gen, transactional annotation RPC, public share RPC
    019       RLS: exclude anonymous sessions
    020-023   filter options RPC, form options RPC, grid indexes, profiles FK embed
    024-025   batch selections + batch_runs
    025b-027  manual card ID dedupe + health check
    028-029   annotation value cleanup RPCs
    030-032   background_details normalization
    033       jumbo_card annotation
    034       manual card rename with history
    035-038   shared Workbench lists, sharing toggle, owner controls, atomic move RPC
    039       workbench pins preferences
    040-043   public share image resolution (overrides, extra, raw_data, fuzzy paths)
    044       camera_angle → multi_select
    045-046   Japanese filter options bucket + sets filter index
    047-048   dead pokemontcg.io experiment + revert
    049       origin 'ptcgdb' CHECK constraint
    050-051   Japanese dual-origin filter options RPC + revert
    053       split per-source filter options RPCs (opt-in, VITE_USE_FILTER_OPTIONS_RPC)
    054       materialized view explore_filter_options (<50ms fast path, default)
  config.toml, functions/, seed.sql

scripts/
  ingest.py                      -- DuckDB ingest; --push-supabase, --clear-failed, --fail-on-partial
  push_duckdb_to_supabase.py     -- upsert API rows → Supabase, refresh materialized view
  migrate_data.py                -- one-time: backup/ → Supabase
  manual_set_normalize.py, normalize_custom_cards_json.py, strip_custom_card_ids.py
  requirements-ci.txt, export_parquet.py (TO BE DELETED)

src/
  main.jsx                       -- QueryClient + router; Sonner Toaster; filter options prefetch
  App.jsx                        -- route shell: Protected + AppLayout, auth routes
  db.js                          -- routes DuckDB vs Supabase (appAdapter.js)
  pages/                         -- ExplorePage, WorkbenchPage, BatchEditPage, DashboardPage,
                                    DataHealthPage, FieldsPage, EditHistoryPage, ProfilePage,
                                    PublicShareCardPage, LoginPage
  components/                    -- CardGrid, FilterPanel, CardDetail, AnnotationEditor,
                                    BatchWizard, CustomCardForm, AppShellHeader, etc.
  lib/                           -- supabaseClient, supabaseAuthBootstrap, mergeExploreFilterOptions,
                                    jpnCardKey, toast, humanizeError, exploreFilterSummary, etc.
  data/supabase/                 -- appAdapter.js, annotationBridge.js

vercel.json, middleware.js, api/share-og.js
.env.local (gitignored), .env.example
playwright.config.mjs, tests/e2e/smoke.spec.js
docs/plans/                      -- feature plans, cutover runbook, smoke checklist, etc.
```

## Site checks (local)

- **`npm run check:quick`** — production build + Node unit tests.
- **`npm run check`** — check:quick + Playwright smoke (DuckDB preview on port 5174).
- Hosted v2 is not exercised by Playwright; use `docs/plans/e2e-vercel-smoke-checklist.md` after deploy.

## Conventions

- Do NOT include `Co-Authored-By` lines in commit messages
- Do not change `main` frontend except live bugfixes for the GitHub Pages site
- Exception: sync ingest-only CI files to `main` so Actions lists the Supabase workflow
- All v2 work on `v2/supabase-migration`. Merge to `main` only when owner explicitly says to. Policy: `docs/ai-agent-merge-policy.md`
- SUPABASE_SERVICE_KEY is NEVER stored in any file — env var only
- Backup directory is gitignored

## AI agents (Cursor / assistants)

When asking for permission, pair the ask with a brief plain-English summary of what will be done.

**Never merge to `main`** unless the owner explicitly requests it. Pushes to `v2/supabase-migration` are fine when asked.

After major feature work, migrations, or pre-release milestones, prompt for a cross-functional panel review (`docs/plans/cross-functional-panel-review.md`).

At every clean break, update the active plan doc and append to `docs/plans/agent-handoff-log.md` with completed work, validation, migration status, risks, and one next action.

Before starting major work, state whether it fits within remaining token limits. If not, propose a narrower slice and define the clean-break handoff point.

## Memory System

**In-repo:** phased plans and resume context under `docs/plans/`. `CLAUDE.md` is the primary project snapshot.

**External:** `/Users/keifergonzalez/.claude/projects/-Users-keifergonzalez-Documents-Coding-Pokemon-Tropius-Maximus/memory/`
