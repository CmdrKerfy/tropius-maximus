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
    """Canonical dedupe key for a Japanese card: lower(set_id) + ':' + normalizeJpnNumber(number).

    A leading "ja-" is dropped from the set ID: Japanese sets whose code is also an
    English set ID are published as "ja-{code}" (ja-sv9, ja-neo1), and must still key
    like the other source's copy of the same card (SV9 + 040 -> "sv9:40").
    """
    if not set_id:
        return None
    set_key = re.sub(r"^ja-", "", str(set_id).lower().strip())
    return f"{set_key}:{_normalize_jpn_number(number)}"
