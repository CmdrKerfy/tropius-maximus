#!/usr/bin/env python3
"""
Pokumon promo pilot importer (dry-run only for now).

Fetches card records from Pokumon's public WordPress API and writes a local
preview report with normalized fields. This script does NOT write to Supabase.

Usage examples:
  python scripts/import_pokumon_promos.py --limit 100
  python scripts/import_pokumon_promos.py --limit 100 --per-page 50
  python scripts/import_pokumon_promos.py --limit 100 --output tmp/pokumon_pilot_preview.json
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

POKUMON_API = "https://pokumon.com/wp-json/wp/v2"
DEFAULT_LIMIT = 100
DEFAULT_PER_PAGE = 100
MAX_PER_PAGE = 100

TITLE_PATTERN = re.compile(r"^\s*(?P<name>.+?)\s*\((?P<detail>.+)\)\s*$")
NUMBER_PATTERN = re.compile(r"(?P<number>[A-Za-z0-9\-]+(?:/[A-Za-z0-9\-]+)?)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a dry-run preview for Pokumon promo import.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max cards to fetch for preview.")
    parser.add_argument(
        "--per-page",
        type=int,
        default=DEFAULT_PER_PAGE,
        help=f"WordPress page size (max {MAX_PER_PAGE}).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tmp/pokumon_pilot_preview.json"),
        help="Output JSON path.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP timeout seconds.",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    # WordPress fields can be doubly escaped (e.g. "&amp;#8217;"), so unescape a few passes.
    for _ in range(3):
        newer = html.unescape(text)
        if newer == text:
            break
        text = newer
    return " ".join(text.strip().split())


def split_title(raw_title: str) -> tuple[str, str]:
    title = clean_text(raw_title)
    m = TITLE_PATTERN.match(title)
    if not m:
        return title, ""
    return clean_text(m.group("name")), clean_text(m.group("detail"))


def extract_number(detail: str) -> str:
    text = clean_text(detail)
    if not text:
        return ""
    m = NUMBER_PATTERN.search(text)
    if m:
        return clean_text(m.group("number"))
    if "unnumbered" in text.lower():
        return "Unnumbered"
    return ""


def pick_image(card: dict[str, Any]) -> str:
    embedded = card.get("_embedded") or {}
    media = embedded.get("wp:featuredmedia") or []
    if media:
        first = media[0] or {}
        source = clean_text(first.get("source_url"))
        if source:
            return source
        details = first.get("media_details") or {}
        sizes = details.get("sizes") or {}
        for size_name in ("full", "large", "medium"):
            item = sizes.get(size_name) or {}
            source = clean_text(item.get("source_url"))
            if source:
                return source
    return ""


def tax_labels(card: dict[str, Any], taxonomy: str) -> list[str]:
    embedded = card.get("_embedded") or {}
    term_groups = embedded.get("wp:term") or []
    labels: list[str] = []
    for group in term_groups:
        if not isinstance(group, list):
            continue
        for item in group:
            if not isinstance(item, dict):
                continue
            if clean_text(item.get("taxonomy")) != taxonomy:
                continue
            name = clean_text(item.get("name"))
            if name:
                labels.append(name)
    return labels


def pick_media_meta(card: dict[str, Any]) -> dict[str, Any]:
    embedded = card.get("_embedded") or {}
    media = embedded.get("wp:featuredmedia") or []
    if not media:
        return {}
    first = media[0] or {}
    details = first.get("media_details") or {}
    return {
        "media_id": first.get("id"),
        "mime_type": clean_text(first.get("mime_type")),
        "width": details.get("width"),
        "height": details.get("height"),
        "source_url": clean_text(first.get("source_url")),
    }


def normalize_card(card: dict[str, Any]) -> dict[str, Any]:
    title_raw = clean_text((card.get("title") or {}).get("rendered"))
    name, detail = split_title(title_raw)
    number = extract_number(detail)
    promo_sets = tax_labels(card, "promo_set")
    languages = tax_labels(card, "language")
    artists = tax_labels(card, "artist")
    holofoil = tax_labels(card, "holofoil")
    release_events = tax_labels(card, "release_event")
    release_year = tax_labels(card, "release_year")
    release_month = tax_labels(card, "release_month")
    release_type = tax_labels(card, "release_type")
    card_type = tax_labels(card, "card_type")
    additional_attributes = tax_labels(card, "additional_attributes")
    cardname = tax_labels(card, "cardname")
    prefix = tax_labels(card, "prefix")
    suffix = tax_labels(card, "suffix")
    image_url = pick_image(card)
    media_meta = pick_media_meta(card)

    wp_id = card.get("id")
    record_id = f"pokumon-{wp_id}" if wp_id is not None else ""
    source_link = clean_text(card.get("link"))
    slug = clean_text(card.get("slug"))

    return {
        "record_id": record_id,
        "wp_post_id": wp_id,
        "name": name,
        "title_raw": title_raw,
        "detail_raw": detail,
        "number_guess": number,
        "set_name_guess": promo_sets[0] if promo_sets else "",
        "language": languages,
        "artist": artists,
        "holofoil": holofoil,
        "release_event": release_events,
        "release_year": release_year,
        "release_month": release_month,
        "release_type": release_type,
        "card_type": card_type,
        "additional_attributes": additional_attributes,
        "cardname": cardname,
        "prefix": prefix,
        "suffix": suffix,
        "media_meta": media_meta,
        "image_url": image_url,
        "source_link": source_link,
        "slug": slug,
        "origin": "manual",
        "origin_detail": "pokumon",
        "is_promo": True,
        "raw_date_gmt": clean_text(card.get("date_gmt")),
        "raw_modified_gmt": clean_text(card.get("modified_gmt")),
    }


def fetch_cards(limit: int, per_page: int, timeout: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    page = 1
    wp_total = None
    wp_total_pages = None

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        while len(cards) < limit:
            response = client.get(
                f"{POKUMON_API}/card",
                params={"per_page": per_page, "page": page, "_embed": 1},
            )
            response.raise_for_status()
            batch = response.json()
            if not isinstance(batch, list) or not batch:
                break

            if wp_total is None:
                wp_total = clean_text(response.headers.get("x-wp-total"))
            if wp_total_pages is None:
                wp_total_pages = clean_text(response.headers.get("x-wp-totalpages"))

            cards.extend(batch)
            if len(batch) < per_page:
                break
            page += 1

    if len(cards) > limit:
        cards = cards[:limit]

    meta = {
        "x_wp_total": wp_total,
        "x_wp_totalpages": wp_total_pages,
        "fetched_count": len(cards),
        "requested_limit": limit,
        "per_page": per_page,
    }
    return cards, meta


def build_report(raw_cards: list[dict[str, Any]], fetch_meta: dict[str, Any]) -> dict[str, Any]:
    normalized = [normalize_card(card) for card in raw_cards]
    missing_image = [row for row in normalized if not row.get("image_url")]
    unparsed_number = [row for row in normalized if not row.get("number_guess")]

    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "mode": "dry-run",
        "source": "pokumon_wp_api",
        "fetch_meta": fetch_meta,
        "summary": {
            "total_preview_rows": len(normalized),
            "missing_image_count": len(missing_image),
            "missing_number_guess_count": len(unparsed_number),
        },
        "rows": normalized,
        "warnings": {
            "missing_image_record_ids": [row["record_id"] for row in missing_image[:100]],
            "missing_number_guess_record_ids": [row["record_id"] for row in unparsed_number[:100]],
        },
    }


def main() -> int:
    args = parse_args()
    limit = max(1, args.limit)
    per_page = min(MAX_PER_PAGE, max(1, args.per_page))

    try:
        raw_cards, fetch_meta = fetch_cards(limit=limit, per_page=per_page, timeout=args.timeout)
    except httpx.HTTPError as exc:
        print(f"Failed to fetch Pokumon cards: {exc}", file=sys.stderr)
        return 1

    report = build_report(raw_cards, fetch_meta)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")

    print(
        f"Wrote dry-run preview: {args.output} "
        f"(rows={report['summary']['total_preview_rows']}, "
        f"missing_image={report['summary']['missing_image_count']}, "
        f"missing_number={report['summary']['missing_number_guess_count']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
