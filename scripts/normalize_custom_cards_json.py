#!/usr/bin/env python3
"""
Rewrite custom_cards.json with the same set_id / set_name normalization as migrate_data.py.

Usage (from repo root):
  python scripts/normalize_custom_cards_json.py public/data/custom_cards.json
  python scripts/normalize_custom_cards_json.py backup/custom_cards.json
"""

import json
import sys
from pathlib import Path

_script_dir = str(Path(__file__).resolve().parent)
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from manual_set_normalize import normalize_manual_card_set_fields


def main():
    if len(sys.argv) < 2:
        print("Usage: normalize_custom_cards_json.py <path/to/custom_cards.json>", file=sys.stderr)
        sys.exit(1)
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"Not found: {path}", file=sys.stderr)
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cards = data.get("cards", data) if isinstance(data, dict) else data
    if not isinstance(cards, list):
        print("Expected { \"cards\": [...] } or a list", file=sys.stderr)
        sys.exit(1)

    n = 0
    for c in cards:
        raw_sid = c.get("set_id")
        raw_sn = c.get("set_name")
        raw_ss = c.get("set_series")
        nsid, nsn, _nss = normalize_manual_card_set_fields(raw_sid, raw_sn, raw_ss)
        if raw_sid != nsid or raw_sn != nsn:
            n += 1
        if nsid is not None:
            c["set_id"] = nsid
        else:
            c.pop("set_id", None)
        if nsn is not None:
            c["set_name"] = nsn
        else:
            c.pop("set_name", None)
        # set_series is not remapped by normalizer; leave as-is

    out = {"cards": cards} if isinstance(data, dict) and "cards" in data else cards
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Updated {path}: normalized {n} card(s).")


if __name__ == "__main__":
    main()
