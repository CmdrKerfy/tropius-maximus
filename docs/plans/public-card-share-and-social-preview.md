# Plan: Public card share links + social / iMessage thumbnails

**Status:** **Shipped** on **`v2/supabase-migration`** (Vercel + Supabase) — read-only **`/share/card/:cardId`**, RPC **`get_public_card_for_share`** (**`018`**), **`api/share-og`**, Edge **`middleware`** (bot → OG HTML), **Copy share link** in **`CardDetail`**. Verified: iMessage preview + mobile + human page.

**Goal:** Let anyone open a **dedicated URL** for **one card** (read-only, no Explore grid, no edit, no access to the rest of the signed-in app) **and** make **WhatsApp / iMessage / etc.** show a **link preview thumbnail** using that card’s artwork.

**Non-goals (initial ship):** Browsing other cards from the share page; deep annotation editing; sharing **collections** or filters; v1 GitHub Pages build (focus on Vercel + Supabase).

---

## Problem statement

| Need | Why it’s tricky |
|------|-----------------|
| **Anonymous user sees only one card** | Today the app is largely **auth-gated**; Explore is not a public catalog. A share link must be a **narrow exception**. |
| **Rich preview (thumbnail)** | iMessage, WhatsApp, Signal, Slack, etc. fetch the URL and look for **Open Graph** tags (`og:image`, `og:title`, …). They **do not log in** and often **do not run JavaScript**. A **Vite SPA** that injects `<meta>` only after React mounts usually **fails** to show the card image in previews. |
| **Security / privacy** | A share link is **“anyone with the link”** access. Decide: public **card id** in URL vs **opaque token**; whether all manual cards are shareable or only some. |

---

## Product decisions (owner — fill before build)

1. **URL shape** — **Shipped:** `/share/card/:cardId`. **Deferred:** opaque token table if enumeration becomes a concern.
2. **What appears on the page** — **Shipped:** Image (or site placeholder), name, set, number, series line; **no** Workbench / grid / next card.
3. **Call to action** — **Shipped:** **Open app** → `/` (auth as configured).
4. **Who can generate a link** — **Shipped:** anyone using the app in Supabase mode (**Copy share link**). **Deferred:** role-based gating if needed.

---

## Recommended architecture (summary)

### A. Public read-only **page** (humans)

- **Shipped:** **`PublicShareCardPage`**, route outside **`Protected`**; data via **`fetchPublicCardForShare`** → RPC **`get_public_card_for_share`** (no session bootstrap required).

### B. **Open Graph + thumbnail** (crawlers)

- **Shipped:** **`/api/share-og?cardId=`** returns minimal HTML + **`og:*`** / Twitter tags; **`middleware.js`** matches expanded **bot User-Agents** and proxies to that API; **`Cache-Control`** on responses; **`/og-card-placeholder.svg`** when card has no image URL.

---

## Phased implementation

### Phase 1 — Product + routing skeleton

- [x] **`PublicShareCardPage`** — read-only UI, no `AnnotationEditor`, no `FilterPanel`; **Open app** CTA only.
- [x] Route **`/share/card/:cardId`** in **`App.jsx`** (outside **`Protected`**).
- [x] **Copy share link** from **`CardDetail`** when Supabase backend.

### Phase 2 — Data access for anonymous readers

- [x] **`fetchPublicCardForShare`** + RPC **`get_public_card_for_share`** (**`018_public_card_share_rpc.sql`**) — safe columns only; **`GRANT EXECUTE`** to **`anon`**.
- [x] **Missing card** — generic not found (no extra leakage).

### Phase 3 — Server-rendered OG HTML (thumbnails)

- [x] **`api/share-og.js`** + **`middleware.js`** + **`vercel.json`** SPA rewrites ( **`/api/*`** handled as serverless**).
- [x] Manual verification: iMessage, mobile; optional: **Facebook Sharing Debugger**.

### Phase 4 — Polish + optional hardening

- [x] **Cache-Control** / CDN-friendly headers on OG HTML; **placeholder image** (`public/og-card-placeholder.svg`) for missing/blocked artwork.
- [ ] **Opaque tokens** — if card-id URLs are too enumerable.
- [ ] **Analytics** (optional): log share opens without PII.

---

## Files (implemented)

| Area | Files |
|------|-------|
| Route + UI | `src/App.jsx`, `src/pages/PublicShareCardPage.jsx` |
| Data | `src/data/supabase/appAdapter.js` (`fetchPublicCardForShare`), `src/db.js`; **`018_public_card_share_rpc.sql`** |
| OG HTML | `api/share-og.js`, `middleware.js`, `vercel.json` |
| Placeholder | `public/og-card-placeholder.svg` |
| Entry | `index.html` unchanged |
| Docs | This file; **`CLAUDE.md`** |

---

## Verification checklist

- [x] Incognito: `/share/card/{validId}` — one card, read-only, no grid, no edit.
- [x] Invalid id — friendly not found.
- [x] iMessage / WhatsApp-style preview — card image (or placeholder).
- [x] Main app: unauthenticated users **still cannot** browse Explore (unchanged).

---

## Relation to other docs

- **`CLAUDE.md`** — public read path for **one card** via RPC only (not broad anon `SELECT` on **`cards`**).
- **`docs/plans/user-profiles-and-activity.md`** — share links orthogonal to dashboard lists.
- **`vercel.json`** — SPA rewrites coexist with **`/api/share-og`**.

---

## Deferred — tabled (owner decision)

The following were considered as follow-ups; they are **not planned** for now because the expected use case is **sharing among people who already use the site** plus **a small number of occasional external viewers**—not a broad public catalog or high-risk data exposure.

| Item | Why table | Revisit when |
|------|-----------|----------------|
| **Opaque share tokens** (anti-enumeration; URLs that hide `card_id`) | Guessable `/share/card/:id` is acceptable for low-profile, trust-based sharing; adds schema, new routes, OG param, and migration work. | Public launch or growth where **URL scanning / guessing** becomes a concern; highly sensitive manual cards; compliance asks for non-guessable links. |
| **Share analytics** (privacy-sensitive logging) | Insight is optional; logging needs careful PII/retention design. | You need **usage metrics**, **debugging** preview issues at scale, or **audit** requirements. |
| **Stricter “who can copy a share link”** (roles / minting) | Any logged-in collaborator sharing with teammates is the intended default; UI-only gates don’t stop manual URL sharing—real enforcement pairs with **token minting** policy. | Abuse (spam links), **compliance** (“only role X may publish public links”), or **paid tiers** where sharing must be restricted. |

**Recommendation:** Keep the shipped **card-id URLs** and **Copy share link** as-is until one of the triggers above applies. Re-open this section before implementing any of the three.

---

*Last updated: 2026-04-18 — shipped + follow-ups (docs, bot list, cache, placeholder); deferred items tabled with rationale.*
