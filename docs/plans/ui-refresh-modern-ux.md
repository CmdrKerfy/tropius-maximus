# Plan: Modern UI / UX refresh (v2)

**Status:** Approved direction — implement on **`v2/supabase-migration`** in slices (merge-friendly PRs).  
**Phase 0 (repo audit):** **Done** on **2026-04-17** (see appendix + **Owner actions** below). Screenshots are optional follow-up for the owner.  
**Progress snapshot (2026-04-18):** Phases **1–7** complete for the scoped UI refresh (Card detail **IA** still **deferred** — see end of doc). **Phase 7** includes **`Dialog`** motion, **Lucide** across shell, Explore, **`CardDetail`**, **`WorkbenchPage`**, **`CustomCardForm`**, **`SqlConsole`**, **`FilterPanel`** (close + chip remove), **`AttributeManager`** button copy; sentence-case primary actions where touched.  
**Audience:** Owner, implementers, AI agents.  
**Companion:** Root **`CLAUDE.md`**, existing stack (React 19, Vite, Tailwind 4, TanStack Query, React Hook Form).

## Goals

1. **Credible shell** — Responsive header/nav that does not collapse into a sloppy stack; clear hierarchy on tablet and mobile.
2. **Human identity in chrome** — **Display name + avatar/initials** in the account area; email only inside menu or Profile (already have `profiles` + avatars).
3. **Trust through feedback** — Consistent **success / error / progress** for saves, submits, queue actions, and auth (toasts + inline where appropriate).
4. **Explore filters that feel intentional** — Active filter summary, advanced vs. primary, mobile-friendly pattern, strong empty/loading states.
5. **Less noise for collaborators** — Power tools (**SQL console**, legacy PAT surfaces) **progressively disclosed** or role-scoped, not competing with core tasks.
6. **Visual consistency** — Shared tokens (spacing, radius, type, semantic color) and reusable components so pages feel like one product.

## Non-goals (initial passes)

- Rewriting business logic or Supabase adapters “for UI.”
- Adding **Bootstrap** (or a second full CSS framework) on top of Tailwind.
- Pixel-perfect redesign of every screen in one PR — ship **vertical slices**.

## Stack decisions (locked for this plan)

| Layer | Choice | Notes |
|--------|--------|--------|
| Styling | **Tailwind CSS 4** (keep) | Single source of utility styling. |
| Primitives / a11y | **Radix UI** via **shadcn/ui**-style copy-paste components **or** Radix directly | Menus, dialogs, dropdowns, tabs — fix resize/accessibility issues without custom keyboard traps. |
| Toasts | **Sonner** (preferred) or **react-hot-toast** | Wire to TanStack Query / mutations globally. |
| Icons | **Lucide React** | Replace inconsistent iconography. |
| Motion (optional) | **Motion** (ex-Framer Motion) | Drawer/toast/modal transitions only; avoid gratuitous animation. |
| Tables (optional, later) | **TanStack Table** | Only if a view becomes spreadsheet-heavy; not required for v1 of this plan. |

**Explicitly out:** Bootstrap, Material UI as a full second theme (too heavy vs. Tailwind-first codebase).

---

## Phase 0 — Discovery & guardrails (0.5–1 day)

**Tasks**

- [x] Screenshot / list **top 5 pain URLs** — **Code audit done** (layout risks below). **Optional:** owner captures **375 / 768 / 1280** screenshots for design reference (not required to start Phase 1).
- [x] Inventory **all headers** / nav patterns — see **Appendix: header inventory**.
- [x] List **user-visible mutations** — see **Appendix: mutation inventory**.
- [x] **SQL console decision** — **Owner chose (a)** on 2026-04-18: SQL only inside **Card data & tools** panel under its own **Advanced: SQL console** section (sibling to **Custom cards**); header SQL button removed (see `ExplorePage.jsx`).

**Exit criteria:** Appendix filled from repo scan; **SQL console path chosen** — **(a) shipped** for Explore.

---

## Phase 1 — Design tokens & primitives (1–2 days)

**Tasks**

- [x] Add **design token layer** — `src/theme/tokens.css` + `@import` from `src/index.css` (**Tropius-inspired** `--color-tm-*`: canopy, leaf, mist, fruit, cream + semantic success/warning/danger/info). **Tweak colors anytime** in that file; no separate “approval gate” unless you want a brand review later.
- [x] Define **documented type scale** in tokens (`src/theme/tokens.css`: `--text-tm-body-sm`, `--text-tm-body`, `--text-tm-heading`, `--text-tm-display`, line-height aliases).
- [x] Introduce **`src/components/ui/`** — `Button.jsx`, `Card.jsx`, `Badge.jsx`, `Input.jsx`, `Skeleton.jsx` (first pass primitives).
- [x] Install **Radix** / **shadcn-style** primitives — `@radix-ui/react-dropdown-menu` added and wrapped via `src/components/ui/DropdownMenu.jsx`; used by `AuthUserMenu.jsx`. (`Dialog`/`Sheet` next with shell work.)

**Exit criteria (met):** Tokens + primitive layer exists and is used in production code: **Explore** uses tm palette + `Button`/`Card`; `AuthUserMenu` uses Radix-based dropdown with profile identity. Remaining pages still use legacy `green-*` until Phase 3 rollout.

**Likely files:** `tailwind.config.*` or `src/index.css`, new `src/components/ui/*`, `package.json`.

---

## Phase 2 — Global feedback (Sonner + Query hooks) (0.5–1 day)

**Tasks**

- [x] Add **Toaster** root in app shell (`main.jsx` or top layout).
- [x] Create **`toastSuccess` / `toastError` / `toastPromise`** helpers (thin wrapper).
- [x] Wire **high-value mutations** first: Workbench save, Batch save, custom card submit, profile save, avatar upload/remove, queue add/remove.
- [x] Standardize **loading** on primary actions (button `disabled` + spinner or “Saving…”).

**Exit criteria:** Above actions show **clear success or error** without opening devtools; errors include **actionable** short text (or “Copy request id” later if you add support).

**Also shipped:** **`src/lib/humanizeError.js`** — maps Postgres / RLS / auth / network patterns to short plain English; long stack traces → generic line. **`toastError(x)`** always runs **`humanizeError(x)`** so call sites may pass raw `Error` objects.

**Likely files:** `src/main.jsx`, `src/lib/toast.js`, `src/lib/humanizeError.js`, mutation call sites in Workbench/Batch/Profile/CustomCardForm/Explore/AnnotationEditor.

---

## Phase 3 — App shell & responsive nav (2–3 days)

**Progress (2026-04-18):** **`AppLayout`** + **`AppShellHeader`** ship for all builds unless **`VITE_EXPERIMENTAL_NAV=false`**. Desktop (**`lg+`**): Explore, Workbench, Activity + Manage data dropdowns, **`AuthUserMenu`**. Small viewports (**`<lg`**): single **Menu** dropdown (Lucide **Menu** icon + chevron) with flat links to all routes (avoids horizontal pill overflow). Explore: **sticky** strip under the shell with **search + result count**; full **`FilterPanel`** remains below (not crammed into global nav). **Optional later:** Radix **Sheet** hamburger, or sticky **filter** summary row.

**Tasks**

- [x] **Single top shell:** logo, **primary nav** (Explore, Workbench, …), **right cluster** (**user menu**). **`src/layouts/AppLayout.jsx`**, **`src/lib/navEnv.js`** (default on).
- [x] **User menu contents:** display name, avatar or initials, links (Dashboard, Profile, History, Sign out); **email** in menu body — **`AuthUserMenu`** + **`fetchProfile`**.
- [x] **Breakpoints:** **`<lg`** → **Menu** dropdown (flat links); **`lg+`** → pills + Activity / Manage data dropdowns.
- [x] **Sticky sub-bar** for Explore (lightweight): **search + result count** sticky under global header when shell is on; filters stay in page flow.

**Exit criteria:** At **768px** width, no overlapping header text; nav usable without horizontal scroll; account area shows **name**, not raw email, when profile has `display_name`.

**Likely files:** `src/App.jsx`, `src/components/AuthUserMenu.jsx`, new `AppHeader.jsx` / `MainNav.jsx`, page headers simplified to avoid duplicate chrome.

---

## Phase 4 — Explore: filter UX overhaul (3–5 days)

**Tasks**

- [x] **Active filter summary** — “**Viewing** …” line (source, search snippet, chip count, sort) + **Reset all**; existing removable chips kept.
- [x] **Primary vs. Advanced** — primary grid (Source, Set, Supertype, Rarity, Artist, Region) + **`<details>` “More filters”** for art/scene controls.
- [x] **Mobile:** **`<lg`** — **Filters** opens **`@radix-ui/react-dialog`** scrollable panel (sheet-style positioning); **`lg+`** keeps collapsible inline panel.
- [x] **Empty / zero results** — plain-language empty state + **Reset search & filters** when constraints are active (`exploreHasActiveConstraints`).
- [x] **Loading** — sticky result strip uses **`Skeleton`**; **`CardGrid`** already uses pulse placeholders while fetching.

**Exit criteria:** Non-technical user can answer “what am I looking at?” and “how do I undo my filters?” in **one glance**; mobile filter flow completable without horizontal scroll.

**Likely files:** `src/pages/ExplorePage.jsx`, `src/components/FilterPanel.jsx`, `src/components/CardGrid.jsx`, `src/lib/exploreFilterSummary.js`, `src/lib/useMediaQuery.js`, `src/components/ui/Dialog.jsx`.

---

## Phase 5 — Workbench & detail polish (2–4 days)

**Tasks**

- [x] Persistent **save status** in workbench chrome: Idle / Saving / Saved / Error (+ **Retry**). `AnnotationEditor` reports lifecycle via **`onSaveStatusChange`**; **`WorkbenchPage`** shows status in the Annotations panel header.
- [x] **Card image + form** layout: **`lg+`** column ratio presets (**Image** / **Balanced** / **Form**), persisted in **`localStorage`** key **`tm_workbench_split_preset`**; wider image well on **`xl`**.
- [x] **Card detail drawer** (Explore): **`CollapsibleSection`** visual grouping; field labels use **`FormFieldLabel`** + **`splitUiLabel.js`** (parentheticals on a second line). **Deeper IA** (restructure tabs/sections) — **deferred** until collaborators exercise the app; see **Deferred checklist** at the bottom of this file.

**Exit criteria:** Annotator never unsure whether last save stuck; detail drawer passes a quick **5-second comprehension** test with a collaborator.

**Likely files:** `src/pages/WorkbenchPage.jsx`, `CardDetail.jsx` (or routed equivalent), annotation editor components.

---

## Phase 6 — Power tools & residual cleanup (1–2 days)

**Tasks**

- [x] **SQL console:** Phase 0 decision shipped — embedded under Explore **Card data & tools → Advanced: SQL console** (warning + toggle).
- [x] **GitHub PAT / legacy copy:** Supabase path aligned with **`docs/plans/custom-card-form-supabase-github-decouple.md`** (Explore copy, `CustomCardForm` lazy GitHub import, `SqlConsole` hides DuckDB-only commit UI on Supabase).
- [x] **Dead links / duplicate nav** audit (shell default): legacy green headers stay for **`VITE_EXPERIMENTAL_NAV=false`**; with shell on, Manage/Activity routes use title strips without duplicating the global pill row.

**Exit criteria:** Default nav for a collaborator shows **no SQL** and **no PAT** unless explicitly in Advanced; power users can still reach SQL if product keeps it.

**Likely files:** `src/App.jsx` routes, SQL console page, `ExplorePage.jsx`, `CustomCardForm.jsx`.

---

## Phase 7 — Motion, icons, microcopy (optional, 1–2 days)

**Tasks**

- [x] Replace ad-hoc icons with **Lucide** — **shell**, Explore (**`SearchBar`**, **`FilterPanel`**, **`CardGrid`**), **`CardDetail`**, **`WorkbenchPage`** (queue nav, split presets, empty queue, saving spinner), **`CustomCardForm`** (collapsible sections), **`SqlConsole`** (header, run/commit, confirm, show-in-grid), **`DropdownMenu`** checkbox indicator, **`FilterPanel`** mobile close + chip remove.
- [x] Subtle **Motion** on **Dialog** (overlay + content: **200ms** `ease-out`, light **zoom-in/out** on content). **Toasts:** Sonner’s built-in motion remains; no extra dependency.
- [x] **Copy** — **CardGrid** empty states; sentence-case on touched primaries (**Add card**, **Add attribute**, **Run query**, **Commit changes**, **Show in grid**, **SqlConsole** confirm). Auth/profile forms already used action-specific verbs (**Sign in**, **Save profile**, **Update password**); left as-is.

**Exit criteria:** No animation longer than **300ms** (Dialog **200ms**); core product surfaces use **Lucide** for the icons we replaced; remaining one-off SVGs (if any) are non-user-facing or legacy DuckDB-only paths.

---

## Dependencies (order matters)

```
Phase 0 (audit + SQL decision)
    → Phase 1 (tokens + ui primitives)
        → Phase 2 (toasts)     ─┐
        → Phase 3 (shell)      │ can parallelize 2 + start of 3 with care
                               ┘
    → Phase 4 (Explore) — best after Phase 1–3 for shared components
    → Phase 5 (Workbench/detail)
    → Phase 6 (power tools) — after nav stable so nothing “disappears” without replacement
    → Phase 7 (polish) — last
```

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **React Rules of Hooks** (blank white screen) | Do not `return` (including `<Navigate />`) before later hooks. Audited/fixed: `AuthUserMenu`, `ProfilePage` invalid `/profile/:userId`. After refactors, smoke **login → Explore → Profile** and `npm run build`. |
| Big-bang PR | **Vertical slices** per phase; feature-flag **nav v2** if needed (`VITE_UI_SHELL_V2`). |
| shadcn + Tailwind 4 friction | Pin docs version; if generator conflicts, use **Radix manually** with same tokens. |
| Toast spam | Debounce repeated saves; collapse “Saved” if same action within N seconds. |
| Regressions on Workbench | E2E checklist: open card, edit field, save, refresh, verify DB still OK. |

## Verification checklist (release gate)

- [ ] **Responsive:** Explore + Workbench usable at **375px** and **768px** without broken header overlap.
- [ ] **Identity:** Header shows **display name** (fallback: initials from email) — not raw email as primary label when profile exists.
- [ ] **Feedback:** Save / submit / profile / avatar show **toast or clear inline success**; failures show **toast +** recoverable next step.
- [ ] **Explore:** Filter summary + reset; advanced filters collapsed by default; zero-results state helpful.
- [ ] **Power tools:** SQL / PAT not in default collaborator path unless explicitly chosen.
- [ ] **A11y:** Keyboard nav for new menus/dialogs; focus trap in modals; color contrast on semantic states.

---

## Deferred checklist — Card detail IA (after live / final testing)

**Do not block earlier phases on this.** Revisit once collaborators have clicked through real sessions.

- [ ] **Map tasks to sections:** e.g. read-only API facts vs. editable annotations vs. actions (Send to Workbench, delete) — reorder and rename so the first screen answers “what can I change here?”
- [ ] **Reduce vertical scan:** consider tabs, stepped flow, or stronger section headers for dense attribute tabs.
- [ ] **Validate with 1–2 non-technical users:** 5-second “where do I edit X?” test; note misses and fix ordering/labels before more engineering.

---

## Owner actions (you chime in here)

**1. SQL Console — ✅ completed**  
Owner chose **(a)** — shipped in **`ExplorePage.jsx`**: header button **Card data & tools** opens a panel with sibling sections **Data & updates**, **Custom cards**, and **Advanced: SQL console** (header SQL button removed).

**2. Color scheme (Tropius)** — **no reply required** unless you want a different mood  
Phase 1 introduced **`src/theme/tokens.css`** (`tm-canopy`, `tm-leaf`, `tm-mist`, `tm-fruit`, `tm-cream`, semantic colors). Edit hex values there anytime; other pages can adopt the same tokens in Phase 3. **Optional later:** you send reference art or “warmer / more pastel” and we retune once.

**3. Optional — visual evidence (when convenient)**  
Capture **Explore** at **375px**, **768px**, and **1280px** after a resize and attach to an issue or drop into `docs/` — helps validate Phase 3. **Not blocking** Phase 2+.

---

## Appendix — Phase 0 audit (repo scan, 2026-04-17)

### Top pain URLs (predicted from layout code)

| URL / area | Risk at narrow width | Why (code) |
|------------|----------------------|------------|
| **`/` Explore** | **High** — header crowding / overlap | `ExplorePage.jsx` header: single `flex … justify-between` row with **logo + long title**, **6× `NavLink`**, then **`AuthUserMenu` + Card data & tools** (SQL moved into panel). **No `flex-wrap`** on that outer row (unlike Workbench/Fields/Batch which use `flex-wrap` + `gap-3`). |
| **`/workbench`** | Medium | Header uses `flex-wrap`; still **many pills** in one band — can wrap into tall stacks. |
| **`/login`** | Lower | Dedicated page; form stacks naturally. |
| **`/profile`**, **`/dashboard`** | Medium | Narrower `max-w-*` layout; **green-800** header (different from Explore’s **green-600**) — **visual inconsistency**. |
| **`/history`** | Medium | Same green-600 nav pattern as Workbench; table horizontal scroll likely on mobile. |

### Appendix: header inventory

| File | Header style | Nav links | Notes |
|------|----------------|-----------|--------|
| `ExplorePage.jsx` | `bg-tm-canopy`, **single-row** `justify-between` (with wrap tweaks) | Explore, Workbench, Health, Fields, Batch, History | **Card data & tools** beside `AuthUserMenu`. **No** Dashboard/Profile in pill row (only in `AuthUserMenu`). |
| `WorkbenchPage.jsx` | `bg-green-600`, `flex-wrap` | Same 6 | `AuthUserMenu` only. |
| `DataHealthPage.jsx` | `bg-green-600`, `flex-wrap` | Same 6 | … |
| `FieldsPage.jsx` | `bg-green-600`, `flex-wrap` | Same 6 | … |
| `BatchEditPage.jsx` | `bg-green-600`, `flex-wrap` | Same 6 | … |
| `EditHistoryPage.jsx` | `bg-green-600`, `flex-wrap` | Same 6 | … |
| `DashboardPage.jsx` | **`bg-green-800`** | Text links: Explore, Workbench, History, Profile | Different chrome. |
| `ProfilePage.jsx` | **`bg-green-800`** | Dashboard, History, Explore | Same. |
| `LoginPage.jsx` / `AuthCallbackPage.jsx` / `AuthResetPasswordPage.jsx` | Own layouts | N/A | No shared shell. |
| `App.jsx` | No global header | Routes only | Every feature page **duplicates** nav — target for Phase 3 **single shell**. |

**`AuthUserMenu.jsx`:** Shows **truncated email** + Dashboard + Profile + Sign out — **no display name / avatar** (Phase 3 will use `profiles`).

### Appendix: mutation inventory

| Action | Location | Success feedback today? | Error / failure feedback? |
|--------|----------|---------------------------|----------------------------|
| Annotation field save (auto) | `AnnotationEditor.jsx` → `patchAnnotations` | **Partial** — small gray “Saved at …” / “Saving…” / undo hint | **`console.error` only** — user may not see failure |
| Annotation save | `CardDetail.jsx` `saveAnnotation` | **`setSaveMessage`** inline (“Saved locally…”) | **`setError`** inline |
| Workbench queue prev/next/remove | `WorkbenchPage.jsx` `patchQueue` | Silent (`invalidateQueries` only) | No toast; fails only if thrown |
| Send card to Workbench | `ExplorePage.jsx` `handleSendToWorkbench` | Navigates to `/workbench` | **`alert(...)`** |
| Batch run | `BatchEditPage.jsx` `runBatch` | Inline result UI (from mutation state) | Via mutation error UI |
| Profile display name | `ProfilePage.jsx` `saveMutation` | **“Saved.”** inline | Inline error |
| Avatar upload / remove | `ProfilePage.jsx` | Invalidate queries; **no toast** | Inline error |
| Custom card create | `CustomCardForm.jsx` | **`success`** state banner | **`error`** banner |
| SQL / local commit | `SqlConsole.jsx` | **`commitMessage`** inline | **`setError`** inline |
| PAT / GitHub | `ExplorePage.jsx` | PAT badge / push status | Mixed |
| Field create/delete | `AttributeManager.jsx` | **Silent** (form reset / refresh) | **`setError`** inline |
| Login / signup / forgot | `LoginPage.jsx` | **`message`** / redirect | **`error`** inline |

**Phase 2 priority:** **`patchAnnotations`** failures (Workbench + Card Detail + AnnotationEditor), **queue mutations**, **Send to Workbench** (replace `alert`), **AttributeManager** success, **avatar** success.

### SQL console decision (owner)

**Chosen option:** **(a)** — SQL console only inside **Card data & tools** panel, section **Advanced: SQL console** (warning + Open/Hide). Header **“SQL Console”** button **removed**. Closing the panel clears SQL panel state.

**Notes:** SQL is **not** a separate route — `SqlConsole` remains embedded in **`ExplorePage.jsx`**.

---

*Created: 2026-04-18 — consolidates UI refresh proposals and library choices into phased, shippable work. Phase 0 appendix: 2026-04-17.*
