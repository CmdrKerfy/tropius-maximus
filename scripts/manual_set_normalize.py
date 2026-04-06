"""
Normalize manual (custom) card set_id / set_name to resolve ambiguous IDs.

Used by migrate_data.py and normalize_custom_cards_json.py. See supabase/migrations/009.
"""

from __future__ import annotations


def _norm_name_key(name: str | None) -> str:
    return " ".join((name or "").split()).lower()


# (set_id, normalized set_name) -> (canonical_set_id, display set_name)
SET_REMAP: dict[tuple[str, str], tuple[str, str]] = {
    ("bjp", "base japanese promos"): ("bjp-base", "Base Japanese Promos"),
    ("bjp", "bw japanese promos"): ("bjp-bw", "BW Japanese Promos"),
    ("custom-jp-promos", "base japanese promos"): ("bjp-base", "Base Japanese Promos"),
    ("custom-jp-promos", "xy japanese promos"): ("custom-jp-promos-xy", "XY Japanese Promos"),
    ("custom-cn-promos", "chinese promos"): ("custom-cn-promos", "CN Promos"),
    ("custom-cn-promos", "cn promos"): ("custom-cn-promos", "CN Promos"),
    ("custom-kr-promos", "kr promos"): ("custom-kr-promos", "KR Promos"),
    ("custom-kr-promos", "korean promos"): ("custom-kr-promos", "KR Promos"),
    ("sjp", "sm japanese promos"): ("sjp-sm", "SM Japanese Promos"),
    ("sjp", "swsh jp promos"): ("sjp-swsh", "SWSH JP Promos"),
    ("sjp", "sv jp promos"): ("sjp-sv", "SV JP Promos"),
    ("x", "xy"): ("x", "XY"),
}


def normalize_manual_card_set_fields(
    set_id: str | None,
    set_name: str | None,
    set_series: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Return (set_id, set_name, set_series) for a manual card row."""
    if not set_id:
        sn = " ".join((set_name or "").split()).strip()
        return None, sn or None, set_series or None
    sn = " ".join((set_name or "").split()).strip()
    key = (set_id, _norm_name_key(sn))
    if key in SET_REMAP:
        nid, nn = SET_REMAP[key]
        return nid, nn, set_series or None
    return set_id, sn or None, set_series or None


def aggregate_manual_set_stubs(card_rows: list[dict]) -> list[dict]:
    """
    Build sets rows for manual origin from normalized card rows.
    Each key is set_id; name is first non-empty set_name seen (stable after normalize).
    """
    meta: dict[str, dict] = {}
    for row in card_rows:
        sid = row.get("set_id")
        if not sid:
            continue
        sn = row.get("set_name") or ""
        ss = row.get("set_series")
        if sid not in meta:
            meta[sid] = {"name": sn or sid, "series": ss}
        else:
            if sn and (meta[sid]["name"] == sid or not meta[sid]["name"]):
                meta[sid]["name"] = sn
            if ss and not meta[sid].get("series"):
                meta[sid]["series"] = ss
    return [
        {
            "id": sid,
            "name": m["name"] or sid,
            "series": m.get("series") or None,
            "origin": "manual",
        }
        for sid, m in sorted(meta.items(), key=lambda x: x[0])
    ]
