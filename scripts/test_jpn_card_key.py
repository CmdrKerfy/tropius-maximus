#!/usr/bin/env python3
"""Parity tests for jpn_card_key normalization — must match JS tests exactly.

Usage:
    python scripts/test_jpn_card_key.py
"""

import sys
from pathlib import Path

# Import from ingest.py
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from jpn_card_key_utils import _normalize_jpn_number, _build_jpn_card_key

# Parity test vectors — must match src/lib/__tests__/jpnCardKey.test.js exactly.
# If you change these, update the JS version too.
TEST_VECTORS = [
    ("1", "1"),
    ("001", "1"),
    ("001a", "1A"),
    ("173/SR", "173SR"),
    ("173 SR", "173SR"),
    ("GG70", "GG70"),
    ("SM-P", "SM-P"),
    ("0", "0"),
    ("000", "0"),
    ("", "0"),
    (None, "0"),
    ("  173/SR  ", "173SR"),
]

# Published "ja-" set IDs key like the unprefixed code.
# Must match KEY_VECTORS in src/lib/__tests__/jpnCardKey.test.mjs exactly.
KEY_VECTORS = [
    ("ja-sv9", "040", "sv9:40"),
    ("SV9", "040", "sv9:40"),
    ("JA-SM6", "1", "sm6:1"),
    ("ja-neo1", "001", "neo1:1"),
    (" ja-xyp ", "XY-P", "xyp:XY-P"),
    ("japan", "1", "japan:1"),
    ("sv9-ja-", "1", "sv9-ja-:1"),
]


def test_normalize_jpn_number():
    failures = 0
    for input_val, expected in TEST_VECTORS:
        result = _normalize_jpn_number(input_val)
        if result != expected:
            print(f"FAIL: _normalize_jpn_number({input_val!r}) = {result!r}, expected {expected!r}")
            failures += 1
    return failures


def test_build_jpn_card_key():
    failures = 0

    # Basic
    result = _build_jpn_card_key("SM12a", "001a")
    if result != "sm12a:1A":
        print(f"FAIL: _build_jpn_card_key('SM12a', '001a') = {result!r}, expected 'sm12a:1A'")
        failures += 1

    # Null set_id
    result = _build_jpn_card_key(None, "1")
    if result is not None:
        print(f"FAIL: _build_jpn_card_key(None, '1') = {result!r}, expected None")
        failures += 1

    # Lowercase set_id
    result = _build_jpn_card_key("SM12A", "1")
    if result != "sm12a:1":
        print(f"FAIL: _build_jpn_card_key('SM12A', '1') = {result!r}, expected 'sm12a:1'")
        failures += 1

    for set_id, number, expected in KEY_VECTORS:
        result = _build_jpn_card_key(set_id, number)
        if result != expected:
            print(f"FAIL: _build_jpn_card_key({set_id!r}, {number!r}) = {result!r}, expected {expected!r}")
            failures += 1

    return failures


if __name__ == "__main__":
    failures = test_normalize_jpn_number()
    failures += test_build_jpn_card_key()
    if failures:
        print(f"\n{failures} test(s) FAILED")
        sys.exit(1)
    print("All jpn_card_key parity tests passed.")
