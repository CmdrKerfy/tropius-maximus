/**
 * Promo archive (origin_detail 'pokumon') attributes live in `cards.raw_data` as string arrays,
 * e.g. `raw_data.release_event = ["Sylveon Collection"]`. Card Detail links them to an Explore
 * filter on `raw_data` (Promo source) instead of a card-name search.
 */

/** Card Detail label → `raw_data` key. */
export const POKUMON_ARCHIVE_FIELDS_BY_LABEL = {
  Language: "language",
  "Holo / foil": "holofoil",
  "Release event": "release_event",
  "Release year": "release_year",
  "Release month": "release_month",
  "Release type": "release_type",
  Prefix: "prefix",
  Suffix: "suffix",
  "Additional attributes": "additional_attributes",
};

const LABEL_BY_KEY = Object.fromEntries(
  Object.entries(POKUMON_ARCHIVE_FIELDS_BY_LABEL).map(([label, key]) => [key, label])
);

export function isPokumonArchiveFilterKey(key) {
  return Object.prototype.hasOwnProperty.call(LABEL_BY_KEY, String(key || ""));
}

export function pokumonArchiveFilterLabel(key) {
  return LABEL_BY_KEY[String(key || "")] || String(key || "");
}

/** Non-empty trimmed strings from a raw_data list value (array or scalar). */
export function pokumonArchiveValues(val) {
  const list = Array.isArray(val) ? val : val == null ? [] : [val];
  return list
    .map((v) => (v == null || typeof v === "object" ? "" : String(v).trim()))
    .filter(Boolean);
}

/**
 * `raw_data @> {"<key>": ["<value>"]}` via PostgREST `cs`. Unknown keys or empty values leave
 * the query unchanged.
 */
export function applyPokumonArchiveFilter(query, key, value) {
  const k = String(key || "").trim();
  const v = String(value || "").trim();
  if (!v || !isPokumonArchiveFilterKey(k)) return query;
  return query.contains("raw_data", { [k]: [v] });
}
