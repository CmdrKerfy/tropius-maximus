#!/usr/bin/env python3
"""Japanese card key normalization — zero-dependency module (no httpx/duckdb).

These functions must match JS `src/lib/jpnCardKey.js` exactly.
They are shared by `ingest.py` and `test_jpn_card_key.py`.
"""

import re
from typing import Optional


def _normalize_jpn_number(number: object) -> str:
    """Deterministic normalization of a Japanese card number.

    Rules (must match JS src/lib/jpnCardKey.js exactly):
    1. Convert to string, trim whitespace
    2. Uppercase all letters
    3. Strip non-alphanumeric/hyphen characters
    4. Strip leading zeros from the numeric prefix only; preserve letter prefixes
    5. If empty after normalization, use "0"
    """
    if number is None:
        return "0"
    s = str(number).strip()
    if not s:
        return "0"
    s = s.upper()
    s = re.sub(r"[^A-Z0-9-]", "", s)
    s = re.sub(r"^(-?)0+(\d)", r"\1\2", s)  # strip leading zeros from numeric prefix
    return s or "0"


def _build_jpn_card_key(set_id: str, number: object) -> Optional[str]:
    """Canonical dedupe key for a Japanese card: lower(set_id) + ':' + normalizeJpnNumber(number)."""
    if not set_id:
        return None
    return f"{str(set_id).lower().strip()}:{_normalize_jpn_number(number)}"
