#!/usr/bin/env python3
"""
One-time migration: existing data → Supabase.

Reads from:
  - backup/cards.csv          (TCG API cards, 20K+)
  - backup/sets.csv           (TCG sets)
  - backup/pocket_cards.csv   (Pocket cards)
  - backup/pocket_sets.csv    (Pocket sets)
  - backup/pokemon_metadata.csv
  - backup/custom_cards.json  (610 manually-entered cards)
  - backup/annotations.json   (615 annotation records)

Writes to Supabase tables:
  - sets, cards, pokemon_metadata, annotations

Usage:
  export SUPABASE_URL=https://your-project.supabase.co
  export SUPABASE_SERVICE_KEY=<secret>   # legacy service_role JWT (eyJ...) OR new secret (sb_secret_...)
  python scripts/migrate_data.py [--dry-run]
  python scripts/migrate_data.py --custom-cards-only   # only backup/custom_cards.json → cards + annotations (manual)

  After syncing ``public/data/custom_cards.json`` from ``main``:
  ``cp public/data/custom_cards.json backup/custom_cards.json`` then ``--custom-cards-only``.

Custom cards: run ``python scripts/normalize_custom_cards_json.py backup/custom_cards.json`` before
migrating if the JSON still has ambiguous set_id values (e.g. bjp). Existing Supabase DBs: apply
``supabase/migrations/009_fix_manual_set_ids_and_labels.sql`` (or push migrations).

Uses the PostgREST client only (``postgrest`` package), not ``supabase``, so new dashboard
secret keys work. Install: pip install -r scripts/requirements-migrate.txt
"""

import csv
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_script_dir = str(Path(__file__).resolve().parent)
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from manual_set_normalize import aggregate_manual_set_stubs, normalize_manual_card_set_fields

try:
    from postgrest import SyncPostgrestClient
except ImportError:
    print("Install postgrest: pip install -r scripts/requirements-migrate.txt")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "backup")
BATCH_SIZE = 500
DRY_RUN = "--dry-run" in sys.argv
CUSTOM_CARDS_ONLY = "--custom-cards-only" in sys.argv

# Fields that are arrays in the annotations schema
ARRAY_FIELDS = {
    "art_style", "main_character", "background_pokemon", "background_humans",
    "additional_characters", "background_details", "emotion", "pose", "actions",
    "items", "held_item", "pokeball", "evolution_items", "berries",
    "card_subcategory", "trainer_card_subgroup", "holiday_theme", "multi_card",
    "video_type", "video_region", "video_location",
}

# Fields that are booleans in the annotations schema
BOOL_FIELDS = {
    "video_appearance", "shorts_appearance", "region_appearance",
    "thumbnail_used", "owned", "pocket_exclusive",
}

# String fields in the annotations schema
STRING_FIELDS = {
    "camera_angle", "perspective", "weather", "environment", "storytelling",
    "card_locations", "pkmn_region", "card_region", "primary_color",
    "secondary_color", "shape", "trainer_card_type", "stamp", "card_border",
    "energy_type", "rival_group", "image_override", "notes", "top_10_themes",
    "wtpc_episode", "video_game", "video_game_location", "video_url",
    "video_title",
}

ALL_ANNOTATION_FIELDS = ARRAY_FIELDS | BOOL_FIELDS | STRING_FIELDS

# Fields to skip (redundant, removed in v2)
SKIP_FIELDS = {"unique_id", "color", "location", "pokemon_main", "pokemon_bg"}


def create_rest_client(url: str, key: str) -> SyncPostgrestClient:
    """PostgREST client for Supabase (accepts JWT and sb_secret_* keys)."""
    base = url.rstrip("/")
    if not base.startswith("http://") and not base.startswith("https://"):
        raise SystemExit(f"SUPABASE_URL must start with http(s)://, got: {url!r}")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    return SyncPostgrestClient(f"{base}/rest/v1", headers=headers)


# ── Helpers ─────────────────────────────────────────────────

def read_csv(filename):
    path = os.path.join(BACKUP_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_json(filename):
    path = os.path.join(BACKUP_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_json_field(val):
    """Parse a JSON string field, return the parsed value or original."""
    if val is None or val == "":
        return None
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return val
    return val


def coerce_array(val):
    """Ensure a value becomes a JSON array. Handles strings, lists, None."""
    if val is None or val == "" or val == "[]":
        return []
    if isinstance(val, list):
        return [v for v in val if v is not None and v != ""]
    if isinstance(val, str):
        # Try parsing as JSON array
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return [v for v in parsed if v is not None and v != ""]
        except (json.JSONDecodeError, ValueError):
            pass
        # Single string value → wrap in array
        val = val.strip()
        if val:
            return [val]
    return []


def coerce_bool(val):
    """Convert various truthy/falsy values to Python bool."""
    if val is None or val == "":
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "1", "yes", "t")
    return bool(val)


def coerce_int(val):
    """Convert to int or None."""
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def safe_json(val):
    """Parse a JSON column from CSV (stored as string)."""
    if val is None or val == "":
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, ValueError):
        return None


def batch_upsert(sb, table, rows, conflict_col="id"):
    """Insert rows in batches, skip empty batches."""
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        if DRY_RUN:
            total += len(batch)
            continue
        result = sb.table(table).upsert(batch).execute()
        total += len(batch)
    return total


# ── Migration Steps ─────────────────────────────────────────

def migrate_sets(sb):
    """Migrate TCG sets + Pocket sets → unified sets table."""
    print("\n=== Migrating sets ===")

    # TCG sets
    tcg_sets = read_csv("sets.csv")
    rows = []
    for s in tcg_sets:
        rows.append({
            "id": s["id"],
            "name": s["name"],
            "series": s.get("series") or None,
            "printed_total": coerce_int(s.get("printed_total")),
            "total": coerce_int(s.get("total")),
            "release_date": s.get("release_date") or None,
            "symbol_url": s.get("symbol_url") or None,
            "logo_url": s.get("logo_url") or None,
            "origin": "pokemontcg.io",
        })
    count = batch_upsert(sb, "sets", rows)
    print(f"  TCG sets: {count}")

    # Pocket sets
    pocket_sets = read_csv("pocket_sets.csv")
    rows = []
    for s in pocket_sets:
        rows.append({
            "id": s["id"],
            "name": s["name"],
            "series": s.get("series") or None,
            "release_date": s.get("release_date") or None,
            "card_count": coerce_int(s.get("card_count")),
            "packs": safe_json(s.get("packs")),
            "logo_url": s.get("logo_url") or None,
            "origin": "tcgdex",
        })
    count = batch_upsert(sb, "sets", rows)
    print(f"  Pocket sets: {count}")

    return len(tcg_sets) + len(pocket_sets)


def migrate_tcg_cards(sb):
    """Migrate TCG API cards → cards table."""
    print("\n=== Migrating TCG cards ===")

    cards = read_csv("cards.csv")
    rows = []
    for c in cards:
        rows.append({
            "id": c["id"],
            "name": c["name"],
            "supertype": c.get("supertype") or None,
            "subtypes": safe_json(c.get("subtypes")) or [],
            "hp": c.get("hp") or None,
            "types": safe_json(c.get("types")) or [],
            "evolves_from": c.get("evolves_from") or None,
            "rarity": c.get("rarity") or None,
            "artist": c.get("artist") or None,
            "set_id": c.get("set_id") or None,
            "number": c.get("number") or None,
            "set_name": c.get("set_name") or None,
            "set_series": c.get("set_series") or None,
            "regulation_mark": c.get("regulation_mark") or None,
            "image_small": c.get("image_small") or None,
            "image_large": c.get("image_large") or None,
            "raw_data": safe_json(c.get("raw_data")) or {},
            "prices": safe_json(c.get("prices")) or {},
            "origin": "pokemontcg.io",
            "format": "printed",
            "last_seen_in_api": datetime.now(timezone.utc).isoformat(),
        })
    count = batch_upsert(sb, "cards", rows)
    print(f"  TCG cards: {count}")
    return count


def migrate_pocket_cards(sb):
    """Migrate Pocket cards → cards table."""
    print("\n=== Migrating Pocket cards ===")

    cards = read_csv("pocket_cards.csv")
    rows = []
    for c in cards:
        card_id = c["id"]
        rows.append({
            "id": card_id,
            "name": c["name"],
            "card_type": c.get("card_type") or None,
            "rarity": c.get("rarity") or None,
            "artist": c.get("illustrator") or None,
            "set_id": c.get("set_id") or None,
            "number": c.get("number") or None,
            "element": c.get("element") or None,
            "hp": c.get("hp") or None,
            "stage": c.get("stage") or None,
            "retreat_cost": coerce_int(c.get("retreat_cost")),
            "weakness": c.get("weakness") or None,
            "evolves_from": c.get("evolves_from") or None,
            "packs": safe_json(c.get("packs")),
            "image_small": c.get("image_url") or None,
            "image_large": c.get("image_url") or None,
            "raw_data": safe_json(c.get("raw_data")) or {},
            "origin": "tcgdex",
            "format": "digital",
            "last_seen_in_api": datetime.now(timezone.utc).isoformat(),
        })
    count = batch_upsert(sb, "cards", rows)
    print(f"  Pocket cards: {count}")
    return count


def migrate_custom_cards(sb):
    """Migrate custom_cards.json → cards table + annotations table."""
    print("\n=== Migrating custom cards ===")

    data = read_json("custom_cards.json")
    cards_list = data.get("cards", data) if isinstance(data, dict) else data

    card_rows = []
    annotation_rows = []

    for c in cards_list:
        # Strip the custom- prefix from the ID for consistent format
        card_id = c["id"]
        if card_id.startswith("custom-custom-"):
            card_id = card_id.replace("custom-custom-", "custom-", 1)

        source = c.get("source", "TCG")

        # Determine origin_detail from source
        if source == "TCG":
            origin_detail = None
        else:
            origin_detail = source

        raw_sid = c.get("set_id") or None
        raw_sn = c.get("set_name") or None
        raw_ss = c.get("set_series") or None
        nsid, nsn, nss = normalize_manual_card_set_fields(raw_sid, raw_sn, raw_ss)

        # Build card row (only card-identity fields)
        card_rows.append({
            "id": card_id,
            "name": c.get("name") or "Unknown",
            "supertype": c.get("supertype") or None,
            "subtypes": safe_json(c.get("subtypes")) or [],
            "hp": c.get("hp") or None,
            "types": safe_json(c.get("types")) or [],
            "evolves_from": c.get("evolves_from") or None,
            "rarity": c.get("rarity") or None,
            "artist": c.get("artist") or None,
            "set_id": nsid,
            "number": c.get("number") or None,
            "set_name": nsn,
            "set_series": nss,
            "regulation_mark": c.get("regulation_mark") or None,
            "image_small": c.get("image_small") or c.get("image_override") or None,
            "image_large": c.get("image_large") or c.get("image_override") or None,
            "evolution_line": c.get("evolution_line") or None,
            "origin": "manual",
            "origin_detail": origin_detail,
            "format": "printed",
        })

        # Extract annotation fields from the custom card
        ann = {}
        for field in ARRAY_FIELDS:
            val = c.get(field)
            if val is not None and val != "" and val != "[]" and val != []:
                ann[field] = coerce_array(val)
        for field in STRING_FIELDS:
            val = c.get(field)
            if val is not None and val != "":
                ann[field] = str(val).strip()
        for field in BOOL_FIELDS:
            val = c.get(field)
            if val is not None and val != "":
                ann[field] = coerce_bool(val)

        # Only create annotation row if there's actual data
        has_data = any(
            ann.get(f) not in (None, "", [], False, "[]")
            for f in ALL_ANNOTATION_FIELDS
            if f in ann
        )
        if has_data:
            ann["card_id"] = card_id
            annotation_rows.append(ann)

    # Ensure custom sets exist (human-readable names from normalized card rows)
    stub_rows = aggregate_manual_set_stubs(card_rows)

    if not DRY_RUN:
        existing = sb.table("sets").select("id").execute()
        existing_ids = {s["id"] for s in existing.data}
        new_sets = [r for r in stub_rows if r["id"] not in existing_ids]
        if new_sets:
            batch_upsert(sb, "sets", new_sets)
            print(f"  Created {len(new_sets)} custom set rows (manual)")

    count = batch_upsert(sb, "cards", card_rows)
    print(f"  Custom cards: {count}")

    ann_count = batch_upsert(sb, "annotations", annotation_rows, conflict_col="card_id")
    print(f"  Custom card annotations: {ann_count}")

    return count, ann_count


def build_annotation_row_from_v1(card_id, ann_data):
    """Map one annotations.json entry → annotations table row dict (v2 columns only)."""
    row = {"card_id": card_id}

    for field in ARRAY_FIELDS:
        val = ann_data.get(field)
        if val is not None and val != "" and val != "[]" and val != []:
            row[field] = coerce_array(val)

    for field in STRING_FIELDS:
        val = ann_data.get(field)
        if val is not None and val != "":
            row[field] = str(val).strip()

    for field in BOOL_FIELDS:
        val = ann_data.get(field)
        if val is not None and val != "":
            row[field] = coerce_bool(val)

    has_data = any(
        k != "card_id" and v not in (None, "", [], False)
        for k, v in row.items()
    )
    return row, has_data


def migrate_annotations(sb):
    """Migrate annotations.json → annotations table (merge with existing)."""
    print("\n=== Migrating annotations ===")

    data = read_json("annotations.json")
    rows = []

    for card_id, ann_data in data.items():
        row, has_data = build_annotation_row_from_v1(card_id, ann_data)
        if has_data:
            rows.append(row)

    count = batch_upsert(sb, "annotations", rows, conflict_col="card_id")
    print(f"  Annotations: {count}")
    return count


def migrate_pokemon_metadata(sb):
    """Migrate pokemon_metadata → pokemon_metadata table."""
    print("\n=== Migrating pokemon metadata ===")

    meta = read_csv("pokemon_metadata.csv")
    rows = []
    for m in meta:
        rows.append({
            "pokedex_number": int(m["pokedex_number"]),
            "name": m.get("name") or None,
            "region": m.get("region") or None,
            "generation": coerce_int(m.get("generation")),
            "color": m.get("color") or None,
            "shape": m.get("shape") or None,
            "genus": m.get("genus") or None,
            "encounter_location": m.get("encounter_location") or None,
            "evolution_chain": safe_json(m.get("evolution_chain")),
        })
    count = batch_upsert(sb, "pokemon_metadata", rows, conflict_col="pokedex_number")
    print(f"  Pokemon metadata: {count}")
    return count


# ── Verification ────────────────────────────────────────────

def verify(sb):
    """Compare counts between source files and Supabase."""
    print("\n=== Verification ===")

    tcg_cards = read_csv("cards.csv")
    pocket_cards = read_csv("pocket_cards.csv")
    custom_data = read_json("custom_cards.json")
    custom_cards = custom_data.get("cards", custom_data) if isinstance(custom_data, dict) else custom_data
    ann_data = read_json("annotations.json")
    tcg_sets = read_csv("sets.csv")
    pocket_sets = read_csv("pocket_sets.csv")
    pokemon_meta = read_csv("pokemon_metadata.csv")

    api_set_ids = {s["id"] for s in tcg_sets} | {s["id"] for s in pocket_sets}
    custom_set_ids = set()
    for c in custom_cards:
        if isinstance(c, dict):
            sid = c.get("set_id")
            if sid:
                custom_set_ids.add(sid)
    custom_stub_count = len(custom_set_ids - api_set_ids)

    ann_qualifying = 0
    if isinstance(ann_data, dict):
        for cid, ad in ann_data.items():
            _, ok = build_annotation_row_from_v1(cid, ad)
            if ok:
                ann_qualifying += 1

    expected = {
        "cards (total)": len(tcg_cards) + len(pocket_cards) + len(custom_cards),
        "cards (TCG API)": len(tcg_cards),
        "cards (Pocket API)": len(pocket_cards),
        "cards (manual)": len(custom_cards),
        "sets": len(tcg_sets) + len(pocket_sets) + custom_stub_count,
        "pokemon_metadata": len(pokemon_meta),
    }

    if DRY_RUN:
        print("  DRY RUN — skipping Supabase count check")
        for label, count in expected.items():
            print(f"  Expected {label}: {count}")
        ann_src_ids = len(ann_data) if isinstance(ann_data, dict) else 0
        print(
            f"  Annotations source: {ann_src_ids} ids in file, "
            f"{ann_qualifying} produce a row (v2 columns only; merges with custom in real run)"
        )
        return True

    # Get actual counts from Supabase
    cards_total = sb.table("cards").select("id", count="exact").execute()
    cards_tcg = sb.table("cards").select("id", count="exact").eq("origin", "pokemontcg.io").execute()
    cards_pocket = sb.table("cards").select("id", count="exact").eq("origin", "tcgdex").execute()
    cards_manual = sb.table("cards").select("id", count="exact").eq("origin", "manual").execute()
    sets_count = sb.table("sets").select("id", count="exact").execute()
    meta_count = sb.table("pokemon_metadata").select("pokedex_number", count="exact").execute()
    ann_count = sb.table("annotations").select("card_id", count="exact").execute()

    actual = {
        "cards (total)": cards_total.count,
        "cards (TCG API)": cards_tcg.count,
        "cards (Pocket API)": cards_pocket.count,
        "cards (manual)": cards_manual.count,
        "sets": sets_count.count,
        "pokemon_metadata": meta_count.count,
    }

    all_ok = True
    for label, exp in expected.items():
        act = actual.get(label)
        status = "✓" if act == exp else "✗ MISMATCH"
        if act != exp:
            all_ok = False
        print(f"  {label}: expected {exp}, got {act} {status}")

    ann_table = ann_count.count
    ann_src_ids = len(ann_data) if isinstance(ann_data, dict) else 0
    print(
        f"  annotations: table {ann_table} rows "
        f"(annotations.json: {ann_src_ids} ids, {ann_qualifying} qualify for v2 columns; "
        "overlaps with custom-card annotations merge by card_id)"
    )

    if all_ok:
        print("\n  All counts match!")
    else:
        print("\n  WARNING: Some counts don't match. Review before proceeding.")

    return all_ok


# ── Main ────────────────────────────────────────────────────

def main():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")
        print("Example:")
        print("  export SUPABASE_URL=https://your-project.supabase.co")
        print("  export SUPABASE_SERVICE_KEY=<service_role or sb_secret_...>")
        print("  python scripts/migrate_data.py")
        sys.exit(1)

    if DRY_RUN:
        print("=== DRY RUN MODE — no data will be written ===")

    sb = create_rest_client(url, key)

    print(f"Migrating data to {url}")
    print(f"Backup directory: {os.path.abspath(BACKUP_DIR)}")

    if CUSTOM_CARDS_ONLY:
        print("\n=== Custom cards only (reads backup/custom_cards.json) ===\n")
        migrate_custom_cards(sb)
        print("\nDone (custom cards only).")
        return

    # Order matters: sets first (FK target), then cards, then annotations
    migrate_sets(sb)
    migrate_tcg_cards(sb)
    migrate_pocket_cards(sb)
    migrate_custom_cards(sb)
    migrate_pokemon_metadata(sb)
    migrate_annotations(sb)

    verify(sb)

    print("\nDone!")


if __name__ == "__main__":
    main()
