#!/usr/bin/env python3
"""
Normalize custom card `id` values in custom_cards.json:

- Strip leading/trailing whitespace
- Turn runs of internal whitespace into a single hyphen (so ids are URL-safe)

If two cards normalize to the same id, the second and later get a suffix from the
card name (e.g. ``custom-bjp-bw-p-mewtwo-ex``).

Usage:
  python3 scripts/strip_custom_card_ids.py
  python3 scripts/strip_custom_card_ids.py public/data/custom_cards.json

Then copy to backup for migrate_data.py if needed:
  cp public/data/custom_cards.json backup/custom_cards.json
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path


def normalize_card_id(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-{2,}", "-", s)
    return s.strip("-")


def name_slug(name: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:48] if s else fallback


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "public/data/custom_cards.json"
    path = path.resolve()

    data = json.loads(path.read_text(encoding="utf-8"))
    cards = data.get("cards")
    if not isinstance(cards, list):
        sys.exit("Expected JSON object with a 'cards' array.")

    indexed: list[tuple[int, dict]] = [(i, c) for i, c in enumerate(cards) if isinstance(c, dict)]
    norm_groups: dict[str, list[tuple[int, dict]]] = defaultdict(list)

    for i, c in indexed:
        old = c.get("id", "")
        if not isinstance(old, str):
            continue
        nid = normalize_card_id(old)
        norm_groups[nid].append((i, c))

    used: set[str] = set()
    for nid, group in norm_groups.items():
        if len(group) == 1:
            _, c = group[0]
            old = c["id"]
            new = nid
            if old != new:
                if c.get("unique_id") == old:
                    c["unique_id"] = new
                c["id"] = new
            used.add(new)
            continue

        group.sort(key=lambda t: t[0])
        for j, (idx, c) in enumerate(group):
            old = c["id"]
            nm = c.get("name") if isinstance(c.get("name"), str) else ""
            if j == 0:
                new = nid
            else:
                slug = name_slug(nm, f"c{idx}")
                candidate = f"{nid}-{slug}"
                k = 2
                while candidate in used:
                    candidate = f"{nid}-{slug}-{k}"
                    k += 1
                new = candidate
            if old != new:
                if c.get("unique_id") == old:
                    c["unique_id"] = new
                c["id"] = new
            used.add(new)

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OK: {path}")
    print(f"  Wrote {len(cards)} card(s).")


if __name__ == "__main__":
    main()
