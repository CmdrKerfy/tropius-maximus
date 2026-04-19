# Implementation plan: Card detail pins + quick card addition

**Status:** **Part A (pins)** — **shipped** in app (apply **`supabase/migrations/015_card_detail_pins.sql`** to each Supabase project). **Part B (quick card addition)** — **B1–B3 shipped** in `CustomCardForm.jsx` (Quick/Full + `tm_custom_card_form_mode`, same-set + Save & add another, session toast, Add & send to Workbench on Supabase). **B4** (pinned-fields-only subsection) still optional / not implemented.  
**Audience:** Owner, implementers, AI agents.  
**Companion:** `docs/plans/ui-refresh-modern-ux.md` (deferred Card detail IA), `CLAUDE.md`, `006` + **`015`** migrations.

---

## Part A — Card detail annotation pins

### Goal

Let signed-in users **choose which annotation fields matter most** for the **Explore card detail** drawer and see them in a **fixed, user-defined order** at the top (or in a dedicated strip), while **every field remains in its original section** below for full context. Pins are **shortcuts to the same data**, not duplicate storage.

### Non-goals (initial ship)

- Automatic ML ordering as the primary control (can be a later enhancement).
- Reordering **every** field in the entire form via drag-and-drop across all sections (high complexity; defer unless requested).
- Pins in **DuckDB / offline** mode: either **localStorage mirror** of the same shape or **feature disabled** with clear copy (match existing Supabase-first patterns).

### Existing schema (reuse)

From **`006_create_user_preferences.sql`**:

- **`user_preferences.quick_fields`** — JSONB array of field keys (default list already exists). **Option 1:** treat this as the **ordered pin list** for card detail + shared “priority fields” elsewhere, and document one canonical meaning. **Option 2:** add a new column e.g. **`card_detail_pins JSONB`** (ordered array of keys) if `quick_fields` is already reserved for another future meaning — decide in implementation after grepping usages.

- **`workbench_queues.fields`** — per-queue subset/order of fields for Workbench. **Card detail pins** should **not** silently overwrite queue fields; either **optional sync** (“Apply workbench queue fields as pins”) or **separate preference** with an explicit user action.

### Data model (recommended shape)

Store an **ordered array of field keys** (strings), each key resolvable via existing **`field_definitions`** + known annotation columns + `extra` dynamic keys:

```json
{
  "card_detail_pins": ["pose", "emotion", "region", "owned"]
}
```

Validation rules:

- Max pins (e.g. **8–12**) to avoid a second full form.
- Drop unknown keys on load (field removed from schema).
- Dedupe.

### API / adapter

- **`fetchUserPreferences()`** / **`patchUserPreferences()`** in `src/data/supabase/appAdapter.js` (add if missing): read/write `user_preferences` for the current user.
- **RLS:** already “users manage own preferences” on `user_preferences` — confirm **SELECT/UPDATE** for authenticated user.

### UI — Card detail (`CardDetail.jsx`)

1. **Pinned strip** (below image / title row, above or overlapping first `CollapsibleSection`):
   - Renders **only** pinned fields **in saved order**, using the **same** input components / `ComboBox` / `MultiComboBox` bindings as in the sections (single source of truth — **one React state** per field; pinned row and section share value + `onChange`).
   - Optional: **“Jump to section”** link per field if the section is collapsed (accessibility + orientation).

2. **Section bodies** unchanged in content; optional **“Pinned”** badge on a section that contains a pinned field (subtle, not noisy).

3. **Pin management UI** (MVP):
   - **“Edit pins”** opens a small **modal or dropdown**: checklist of available fields (from `field_definitions` + static list for core columns), **drag-to-reorder** in the modal, **Save** / **Cancel**.
   - **Clear all pins** action.

4. **Empty pins:** no strip; detail matches today’s layout.

### Workbench / Batch alignment (later phase in same epic)

- **Workbench:** optionally **default new queues** or **“Sync from card detail pins”** button to copy `card_detail_pins` → `workbench_queues.fields` (user-initiated).
- **Batch edit:** optional **column order** or **“priority columns first”** driven by the same `card_detail_pins` array (separate small task).

### Phasing

| Phase | Scope |
|--------|--------|
| **A1** | [x] Migration **`015`**, **`fetchUserPreferences` / `upsertUserPreferences`** in **`appAdapter`** + **`db.js`** (localStorage fallback **`tm_card_detail_pins`**) |
| **A2** | [x] Pinned strip + **`CardDetailFieldControl`** (same `saveAnnotation` as main form) |
| **A3** | [x] **`CardDetailPinEditor`** modal (add/remove, ↑↓ order, max 12) |
| **A4** | [ ] Optional Workbench/Batch column order from pins; expand **`CARD_DETAIL_PINNABLE_KEYS`** beyond the initial 12 keys |

### Risks

- **State duplication bugs** if pinned row and section use separate `useState` — use **one** annotations object + single `patchAnnotations` path.
- **Performance:** large `CardDetail` — pinned strip should render **subset** only.

### Files (likely)

- `supabase/migrations/0xx_card_detail_pins.sql` (if new column)
- `src/data/supabase/appAdapter.js`
- `src/components/CardDetail.jsx`
- New: `src/components/CardDetailPinEditor.jsx` or inline modal
- `src/db.js` re-exports if needed

---

## Part B — Quick card addition (Custom Card Form)

### Goal

Support **fast repeated entry** of many cards (e.g. 10+) by **minimizing scrolling and cognitive load**: **required identity fields first**, **optional / annotation-heavy blocks collapsed or deferred**, **Save & add another** with **sticky context** (e.g. same set), optional **handoff to Workbench** for annotation passes.

### Non-goals (initial ship)

- Replacing Workbench for deep annotation (defer rich editing to after create).
- Changing server-side ID generation rules or ingest.

### UX modes

1. **Quick add (default for users who use bulk entry)**  
   - Single **“Required”** card (TCG/Pocket) fields visible without scroll on typical laptop.
   - All **annotations / long tail** in one **collapsed** `<details>` or `CollapsibleSection` (“Details & annotations — optional”).
   - **Sticky sub-bar** or inline reminder: “You can add details later in Explore or Workbench.”

2. **Full form (toggle)**  
   - Expands all sections (current behavior approximated), for rare full entry at create time.

Persist mode in **`localStorage`** key e.g. `tm_custom_card_form_mode` = `quick` | `full` (no migration required).

### Behaviors

| Behavior | Detail |
|----------|--------|
| **Save & add another** | After successful save: reset **card-specific** fields (id/name/number/image/…); **retain** user-chosen **set** + **source** + **card table (TCG/Pocket)** if “Same set” toggle is on (default **on** for quick mode). |
| **Same set toggle** | Checkbox: “Keep set & source for next card” — reduces re-entry for a single-set batch. |
| **Focus** | After reset, focus **name** or **number** (whichever is first empty). |
| **Optional toast** | “Card added — N saved this session” for morale / undo affordance later. |
| **Open in Workbench** | Optional secondary button **“Add & send to Workbench”** if Supabase + queue exists (reuse existing send pattern from Explore). |

### Relation to pins (optional integration)

- **Do not** mirror the full **card detail pin list** on the custom card form by default — it would recreate Workbench length.
- **Optional:** under “Details & annotations”, a line: **“Show my pinned fields only”** that filters which optional fields appear — pulls from the same `user_preferences` pin list **intersected** with fields that exist on the form. If empty, show a link **“Edit pins in card detail”** (or Fields page later).

### Phasing

| Phase | Scope |
|--------|--------|
| **B1** | [x] Quick vs Full toggle + `localStorage` (`tm_custom_card_form_mode`); optional fields in one **Details & annotations** `<details>` in Quick |
| **B2** | [x] “Same set” retention + **Save & add another** reset + focus |
| **B3** | [x] **Add & send to Workbench** (Supabase); session counter toast on add |
| **B4** | [ ] Optional **pinned-fields-only** subsection under details |

### Files (likely)

- `src/components/CustomCardForm.jsx` (structure, toggles, reset logic)
- `src/pages/ExplorePage.jsx` (only if entry point copy or panel defaults change)
- `src/db.js` / `appAdapter.js` only if preferences are read for optional pin-filter subsection

### Risks

- **Validation:** quick mode must still enforce **minimum** required fields per TCG vs Pocket vs manual rules.
- **Supabase vs DuckDB:** quick mode should not assume GitHub PAT; align with existing decouple doc.

---

## Ordering of work

1. **Part B (Quick add)** — independent, immediate user value for bulk entry; mostly frontend + localStorage.  
2. **Part A (Pins)** — needs preferences API wiring + careful state in `CardDetail`; ship after or in parallel if two devs.

Alternatively: **A1–A2** first if Workbench/Batch alignment is the top priority.

---

## Exit criteria

- **Part A:** User can set ≥1 pin, order persists across sessions; editing in pin strip updates the same values as in sections; no duplicate conflicting saves.
- **Part B:** Quick mode allows adding multiple cards with minimal scrolling; “same set” works; Full mode restores comprehensive layout.
