# Plan: Modern UI / UX refresh (v2)

**Status:** Approved direction — implement on **`v2/supabase-migration`** in slices (merge-friendly PRs).  
**Phase 0 (repo audit):** **Done** on **2026-04-17** (see appendix + **Owner actions** below). Screenshots are optional follow-up for the owner.  
**Progress snapshot (2026-04-18):** Phase **1** done · Phase **2** done (Sonner + **`humanizeError`** on **`toastError`**) · Phase **3** partial: optional **`VITE_EXPERIMENTAL_NAV`** canopy shell + dropdown nav + gated page headers (default-off) · Phases **4–7** not started.  
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

**Progress (2026-04-18):** When **`VITE_EXPERIMENTAL_NAV=true`**, **`AppLayout`** + **`AppShellHeader`** provide a canopy bar (Explore, Workbench, Activity + Manage data dropdowns, **`AuthUserMenu`**); authenticated routes are nested under one **`Protected`** parent; page-level headers are hidden to avoid duplicate chrome; Explore keeps **Card data & tools** on a slim bar. **Still open:** turn shell on by default (or ship flag), `< lg` **More** / **Sheet** pattern, sticky Explore filter row, full Phase 3 exit criteria at **768px** without relying on the flag alone.

**Tasks**

- [ ] **Single top shell:** logo, **primary nav** (Explore, Workbench, …), **right cluster** (optional search trigger, **user menu**). *(Experimental: `AppShellHeader` behind **`VITE_EXPERIMENTAL_NAV`** — see `src/layouts/AppLayout.jsx`.)*
- [ ] **User menu contents:** display name, avatar or initials, links (Dashboard, Profile, History, Sign out); **email** secondary or bottom of menu — use **`fetchProfile`** / session (already have profile data paths).
- [ ] **Breakpoints:** e.g. `< lg` collapse secondary routes into **`More` dropdown** or **Sheet**; avoid 3-row header stacks.
- [ ] **Sticky sub-bar** for Explore (optional in this phase): filter trigger + result count — do not cram into global nav row.

**Exit criteria:** At **768px** width, no overlapping header text; nav usable without horizontal scroll; account area shows **name**, not raw email, when profile has `display_name`.

**Likely files:** `src/App.jsx`, `src/components/AuthUserMenu.jsx`, new `AppHeader.jsx` / `MainNav.jsx`, page headers simplified to avoid duplicate chrome.

---

## Phase 4 — Explore: filter UX overhaul (3–5 days)

**Tasks**

- [ ] **Active filter summary** — chips or one-line “You’re viewing: …” with clear **reset**.
- [ ] **Primary vs. Advanced** — collapse low-usage filters behind **Advanced** (`Disclosure` or accordion).
- [ ] **Mobile:** filters in **`Sheet`** / drawer from a single **“Filters”** button; desktop keeps panel or two-column layout.
- [ ] **Empty / zero results** — explain *why* (filters too narrow) + **Reset filters** CTA.
- [ ] **Loading skeletons** for grid cards (replace generic “loading” text where needed).

**Exit criteria:** Non-technical user can answer “what am I looking at?” and “how do I undo my filters?” in **one glance**; mobile filter flow completable without horizontal scroll.

**Likely files:** `src/pages/ExplorePage.jsx`, filter components (extract if monolithic), `src/components/*Filter*`.

---

## Phase 5 — Workbench & detail polish (2–4 days)

**Tasks**

- [ ] Persistent **save status** in workbench chrome: Idle / Saving / Saved / Error (+ retry where safe).
- [ ] **Card image + form** layout tuned for **1280 and 1440**; optional split ratio presets.
- [ ] **Card detail drawer** (Explore): consistent padding, section headings, fewer “walls of labels” — group fields (metadata vs. annotation vs. actions).

**Exit criteria:** Annotator never unsure whether last save stuck; detail drawer passes a quick **5-second comprehension** test with a collaborator.

**Likely files:** `src/pages/WorkbenchPage.jsx`, `CardDetail.jsx` (or routed equivalent), annotation editor components.

---

## Phase 6 — Power tools & residual cleanup (1–2 days)

**Tasks**

- [ ] **SQL console:** implement Phase 0 decision — relocate route, add env flag, or hide behind Advanced dialog with warning copy.
- [ ] **GitHub PAT / legacy copy:** align with **`docs/plans/custom-card-form-supabase-github-decouple.md`** — no PAT implied for Supabase success paths.
- [ ] **Dead links / duplicate nav** audit after shell change — remove duplicate “Profile” in page header + global nav if redundant.

**Exit criteria:** Default nav for a collaborator shows **no SQL** and **no PAT** unless explicitly in Advanced; power users can still reach SQL if product keeps it.

**Likely files:** `src/App.jsx` routes, SQL console page, `ExplorePage.jsx`, `CustomCardForm.jsx`.

---

## Phase 7 — Motion, icons, microcopy (optional, 1–2 days)

**Tasks**

- [ ] Replace ad-hoc icons with **Lucide** set.
- [ ] Subtle **Motion** on Sheet/Dialog/toast (150–200ms).
- [ ] Pass on **button verbs** (“Save changes” vs “Submit”) and **empty states** copy.

**Exit criteria:** No animation longer than **300ms**; reduced “mixed icon styles” grep to near zero.

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
