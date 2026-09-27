# Card-adjacent items: TCGCSV sealed products and Pokémon Scrap (idea stage)

**Status:** Idea stage. Read-only research only (2026-09-27). Nothing is written to Supabase, DuckDB, or the repo data. No work starts without an owner decision on the questions below.

**Origin:** Owner idea researched 2026-09-26; read-only report run 2026-09-27 (see `docs/plans/agent-handoff-log.md`).

---

## Part A — TCGCSV (TCGplayer catalog) report

TCGCSV (`tcgcsv.com`) mirrors TCGplayer's catalog API as cached JSON, refreshed daily (`last-updated.txt` was `2026-09-26T20:05:16+0000` at fetch time). Categories: **3** "Pokemon" (English) and **85** "Pokemon Japan". The FAQ asks clients to send an identifiable User-Agent and sleep ~0.25 s between requests; the report fetch did both (`TropiusMaximus-readonly-report/1.0`, one request per group, ~680 requests).

Endpoints used: `/tcgplayer/{cat}/groups`, `/tcgplayer/{cat}/{groupId}/products`. Prices (`/prices`) were not fetched.

**How cards and non-card items are told apart:** card products carry `Number` and/or `Rarity` in `extendedData`; sealed/other products do not (a booster box has only `CardText`). The report classifies non-card items by name keywords, so type counts are approximate.

### Counts (fetched 2026-09-27, all groups)

| | Category 3 (English) | Category 85 (Japan) |
|---|---:|---:|
| Groups (sets) | 220 | 459 |
| Card products | 29,911 | 30,321 |
| **Non-card products** | **2,936** | **369** |
| Groups with any non-card item | 175 | 162 |
| Non-card-only groups | 1 (`ME06: Delta Reign`, unreleased, published 2026-11-06) | 5 (e.g. Special Box Collections, Quick Starter Gift Sets) |
| Non-card items with an image | 2,844 (92 without) | 307 (62 without) |

Non-card items by type (keyword classification; approximate, e.g. "Case" includes Detective Pikachu "Case File" boxes and "Booster Pack" includes 3-pack blisters):

| Type | English | Japan | Examples |
|---|---:|---:|---|
| Booster Pack (incl. blisters) | 890 | 107 | Unified Minds Booster Pack; 3 Pack Blister [Stakataka] |
| Tin | 500 | — | Power Partnership Tin [Mewtwo & Mew GX] |
| Premium / Special Collection | 466 | 19 | Mewtwo V-UNION Special Collection; Premium Trainer Box ex |
| Theme / Battle / Starter Deck | 317 | 59 | Unified Minds Theme Deck "Soaring Storm"; Starter Set ex Zoroark ex |
| Other (unclassified) | 268 | 76 | Prerelease Kit; Porygon-Z GX Box; McDonald's Japan Promo Booster (2025) |
| Elite Trainer Box | 210 | — | Chaos Rising Elite Trainer Box (and ETB Case) |
| Booster Box / Display | 165 | 108 | Unified Minds Booster Box; Violet ex Booster Box |
| Booster Bundle | 76 | — | Chaos Rising Booster Bundle |
| Case | 27 | — | Fall 2022 Collector Chest Case |
| Bundle / Lot | 9 | — | Costco bundles; "[Set of 2]" listings |
| Binder / Accessory | 8 | — | Starter Figure Boxes |

Observations:
- English sealed coverage is broad (~3k items). Japanese sealed coverage is thin (369 items across 459 groups): mostly booster boxes/packs and starter decks, so Japanese box art would be incomplete.
- Case listings (e.g. "Booster Box Case", "ETB Case") are the same art as the inner product; a real import would filter or collapse them.
- TCGplayer also lists **cards** for both categories (~60k products). That overlaps our existing cards and is not in scope here; the only use would be a later cross-reference (e.g. TCGplayer product ID per card).
- Pokémon Scrap is **not** listed on TCGplayer (the only "scrap" matches are "Skyscraping Perfection"), so TCGCSV does not help Part B.
- Raw cache: ~73 MB in the agent scratchpad (not in the repo); re-fetchable from the two endpoints above (one products request per group, 0.25 s apart, ~5 minutes).

### Images

- Every product has `imageUrl` `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_200w.jpg` when `imageCount > 0`.
- Larger sizes exist on the same CDN: `_400w.jpg` (booster box sample 79 KB) and `_in_1000x1000.jpg` (88 KB). `_1000x1000.jpg` is 403.
- Hotlinking vs mirroring and TCGplayer's terms need the same owner review as Pocket artwork (remediation plan 1E.4). TCGCSV is an unofficial mirror; TCGplayer's catalog terms apply to the data.

### Current database state (read-only, 2026-09-27)

- No sealed/non-card products exist in `cards` (name search for booster box/pack/bundle, elite trainer, tin, collection box, theme deck, blister: only the trainer card "Suspicious Food Tin").
- `cards` constraints: `origin` in ('pokemontcg.io','tcgdex','ptcgdb','manual'); `format` in ('printed','digital','promotional'). There is no item-type column.

### Schema options (owner decision needed before any write)

1. **Separate `products` table (recommended if sealed items are wanted).** Own columns (TCGplayer `productId`, group, product type, release date, image), own annotations later if needed. Explore stays card-only; a separate "Products" view browses them. Keeps every card query, index, filter-options view, and count unchanged.
2. **Add `item_type` to `cards`** (`card` default, `sealed`, …) plus a new `origin` value. Reuses the grid and annotation form, but every card query, filter, count, the materialized view, share page, and Data Health checks must learn to exclude or handle non-cards. Higher regression risk.
3. **Do nothing / link out.** Show a "Sealed products" link to TCGplayer per set. No data stored.

Open questions for the owner:
- Is the goal browsing and annotating sealed-product artwork (box art, pack art), or tracking ownership/prices?
- English only, Japanese only, or both?
- Which product types matter (booster packs/boxes, ETBs, tins, collections, decks, accessories)?
- Hotlink TCGplayer images, or mirror (needs a terms review)?

Suggested next slice if wanted: a plan doc for option 1 with a DuckDB-only dry-run importer (no Supabase writes) that maps TCGCSV groups to our `sets` rows and reports unmatched groups.

---

## Part B — Pokémon Scrap (Japan-only serial-code cards)

### What they are (sources: pocketmonsters.net/news/2031; owner research 2026-09-26)

- Physical cards packed with Japanese products (TCG booster packs, PokéPan and other food, McDonald's Happy Sets in January 2015, arcade shops, other merchandise). Each has a unique serial code on the back for the Pokémon Scrap campaign site, which unlocked in-game rewards (2015 campaign: Shaymin, Keldeo, Victini and five items in Omega Ruby / Alpha Sapphire, collected 2014-11-01 to 2015-04-30).
- Campaigns: 2015, 2016, 2017. "Over 50 different Scrap Cards" in 2015; 2016/2017 counts unknown.
- No card numbers or set codes are documented; only the serial code. No structured data source exists (Bulbapedia covers the in-game rewards, not the card designs; TCGplayer/TCGCSV does not list them either, checked 2026-09-27).

### Current database state (read-only, 2026-09-27)

- **None exist.** The 8 rows matching "scrap" are all the trainer card "Tool Scrapper" (pokemontcg.io and two `pokumon` manual rows).
- Precedent: Japan-exclusive promos are `origin = 'manual'`, `origin_detail = 'Japan Exclusive'`, `format = 'printed'`, grouped in manual sets (`ejp` eReader Japanese Promos 203, `jvs` JP Vending Series 115, `jm` JP Mcdonalds 18, …). Their images are external URLs (scrydex 782, bulbagarden archives 277, a long tail of other hosts, 13 with none). No card images are stored in Supabase Storage today; only avatars have a bucket.

### Design checklist (owner decisions before entering any)

- [ ] **Set grouping:** one set per campaign year (e.g. "Pokémon Scrap 2015", "…2016", "…2017") or one "Pokémon Scrap" set. One per year is recommended (matches `jm`/`jvs` style and keeps each set small).
- [ ] **Set IDs:** short manual IDs in the existing style, e.g. `scrap15`, `scrap16`, `scrap17`. No `sets` row matches `scrap%` or a "scrap" name today (checked 2026-09-27); re-check before creating.
- [ ] **Numbering:** Scrap cards have no printed number. Pick a stable scheme (e.g. `001`–`05x` in a documented order, such as the campaign site's order or Pokémon National Dex order) and record it here. Manual card IDs are generated server-side as `custom-{set}-{number}` (`generate_card_id_manual`, migration 016; existing rows look like `custom-ejp-0`) and are hard to change later (annotations, history, pins, and share links reference them). A blank number produces IDs like `custom-td--`, which several existing sets already have; avoid that.
- [ ] **Fields:** `origin_detail = 'Japan Exclusive'`, `format`: `promotional` (redeemable voucher) or `printed` (existing Japan promos use `printed`). Recommend `promotional` only if the owner wants them filterable apart from ordinary promos; otherwise `printed` for consistency.
- [ ] **Card name:** the featured Pokémon (English name; Japanese name in a field or annotation if wanted), so name search and bilingual `+` search work.
- [ ] **Distribution/product:** where each design came from (booster pack, PokéPan, McDonald's, …). Store in an annotation or `extra` field, not the set name.
- [ ] **Images (owner-supplied):** the custom card form takes image **URLs**, not uploads. Options: (a) host owner photos/scans somewhere stable and paste URLs; (b) add a Supabase Storage bucket for card images (new work: bucket, policy, upload UI — its own plan); (c) enter cards without images first and add them later. Avoid volatile hosts (Bing thumbnails, forum attachments) — several existing manual cards already use them.
- [ ] **Serial codes:** do not store real codes (they are single-use redemption secrets and not artwork metadata).
- [ ] **Entry path:** the existing Workbench "Add card" / CustomCardForm with "Keep set & source" handles a batch of ~50 in one sitting; no importer needed unless a structured list appears.
- [ ] **Checklist source:** the owner supplies the list of designs per year (names + images). Without a list, enter only designs the owner has on hand and record the list as incomplete in the set name or a note.

No schema change is needed for Scrap: it fits the existing manual flow.
