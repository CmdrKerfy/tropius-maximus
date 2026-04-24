#!/usr/bin/env python3
"""
Phase-2 analyzer for Pokumon pilot dry-run output.

Reads tmp/pokumon_pilot_preview.json and emits:
- JSON summary (machine-readable)
- Markdown summary (human review notes)

No database writes are performed.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze Pokumon pilot preview output.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("tmp/pokumon_pilot_preview.json"),
        help="Path to dry-run preview JSON.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("tmp/pokumon_pilot_analysis.json"),
        help="Path for computed summary JSON.",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=Path("tmp/pokumon_pilot_analysis.md"),
        help="Path for human-readable markdown summary.",
    )
    return parser.parse_args()


def top_items(counter: Counter[str], limit: int = 10) -> list[dict[str, Any]]:
    return [{"value": value, "count": count} for value, count in counter.most_common(limit)]


def list_values(row: dict[str, Any], key: str) -> list[str]:
    val = row.get(key)
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    return []


def build_analysis(rows: list[dict[str, Any]], fetch_meta: dict[str, Any]) -> dict[str, Any]:
    by_record_id = Counter()
    by_wp_post_id = Counter()
    by_slug = Counter()
    by_image = Counter()
    by_number_set_lang = Counter()

    languages = Counter()
    promo_sets = Counter()
    holofoil = Counter()
    artists = Counter()

    invalid_rows: list[dict[str, Any]] = []
    html_entity_name_rows: list[str] = []
    missing_image_rows: list[str] = []
    missing_number_rows: list[str] = []

    for row in rows:
        record_id = str(row.get("record_id", "")).strip()
        wp_post_id = str(row.get("wp_post_id", "")).strip()
        slug = str(row.get("slug", "")).strip()
        image_url = str(row.get("image_url", "")).strip()
        number = str(row.get("number_guess", "")).strip()
        set_name = str(row.get("set_name_guess", "")).strip()
        lang = "|".join(sorted(list_values(row, "language")))

        by_record_id[record_id] += 1
        by_wp_post_id[wp_post_id] += 1
        by_slug[slug] += 1
        if image_url:
            by_image[image_url] += 1

        number_set_lang_key = f"{number}::{set_name}::{lang}"
        by_number_set_lang[number_set_lang_key] += 1

        for v in list_values(row, "language"):
            languages[v] += 1
        if set_name:
            promo_sets[set_name] += 1
        for v in list_values(row, "holofoil"):
            holofoil[v] += 1
        for v in list_values(row, "artist"):
            artists[v] += 1

        name = str(row.get("name", ""))
        if "&#" in name or "&amp;" in name:
            html_entity_name_rows.append(record_id)
        if not image_url:
            missing_image_rows.append(record_id)
        if not number:
            missing_number_rows.append(record_id)
        if not record_id or not wp_post_id or not slug:
            invalid_rows.append(
                {
                    "record_id": record_id,
                    "wp_post_id": wp_post_id,
                    "slug": slug,
                }
            )

    dup_record_ids = [k for k, v in by_record_id.items() if k and v > 1]
    dup_wp_ids = [k for k, v in by_wp_post_id.items() if k and v > 1]
    dup_slugs = [k for k, v in by_slug.items() if k and v > 1]
    dup_number_set_lang = [k for k, v in by_number_set_lang.items() if k and v > 1]

    return {
        "summary": {
            "preview_rows": len(rows),
            "missing_image_count": len(missing_image_rows),
            "missing_number_count": len(missing_number_rows),
            "invalid_row_count": len(invalid_rows),
            "duplicate_record_id_count": len(dup_record_ids),
            "duplicate_wp_post_id_count": len(dup_wp_ids),
            "duplicate_slug_count": len(dup_slugs),
            "duplicate_number_set_lang_count": len(dup_number_set_lang),
            "html_entity_name_count": len(html_entity_name_rows),
        },
        "fetch_meta": fetch_meta,
        "top_distributions": {
            "languages": top_items(languages, 12),
            "promo_sets": top_items(promo_sets, 12),
            "holofoil": top_items(holofoil, 12),
            "artists": top_items(artists, 20),
        },
        "duplicates": {
            "record_ids": dup_record_ids[:200],
            "wp_post_ids": dup_wp_ids[:200],
            "slugs": dup_slugs[:200],
            "number_set_lang": dup_number_set_lang[:200],
        },
        "quality_flags": {
            "rows_with_html_entities_in_name": html_entity_name_rows[:200],
            "rows_missing_image": missing_image_rows[:200],
            "rows_missing_number": missing_number_rows[:200],
            "invalid_rows": invalid_rows[:200],
        },
    }


def markdown_report(analysis: dict[str, Any]) -> str:
    s = analysis["summary"]
    lines = [
        "# Pokumon Pilot Analysis (Phase 2)",
        "",
        "## Summary",
        f"- Preview rows: {s['preview_rows']}",
        f"- Missing image: {s['missing_image_count']}",
        f"- Missing number guess: {s['missing_number_count']}",
        f"- Invalid rows: {s['invalid_row_count']}",
        f"- Duplicate record_id: {s['duplicate_record_id_count']}",
        f"- Duplicate wp_post_id: {s['duplicate_wp_post_id_count']}",
        f"- Duplicate slug: {s['duplicate_slug_count']}",
        f"- Duplicate number+set+language keys: {s['duplicate_number_set_lang_count']}",
        f"- Names still containing HTML entities: {s['html_entity_name_count']}",
        "",
        "## Top Distributions",
    ]

    for label in ("languages", "promo_sets", "holofoil", "artists"):
        lines.append(f"### {label.replace('_', ' ').title()}")
        for item in analysis["top_distributions"][label]:
            lines.append(f"- {item['value']}: {item['count']}")
        if not analysis["top_distributions"][label]:
            lines.append("- (none)")
        lines.append("")

    lines.extend(
        [
            "## Notes",
            "- This analyzer checks pilot quality only; it does not query Supabase for collision checks.",
            "- Use this report before staging table insert.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = payload.get("rows", [])
    fetch_meta = payload.get("fetch_meta", {})

    analysis = build_analysis(rows=rows, fetch_meta=fetch_meta)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_md.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(analysis, ensure_ascii=True, indent=2), encoding="utf-8")
    args.output_md.write_text(markdown_report(analysis), encoding="utf-8")

    summary = analysis["summary"]
    print(
        "Phase-2 analysis complete: "
        f"rows={summary['preview_rows']}, "
        f"dup_record_id={summary['duplicate_record_id_count']}, "
        f"dup_number_set_lang={summary['duplicate_number_set_lang_count']}, "
        f"missing_image={summary['missing_image_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
