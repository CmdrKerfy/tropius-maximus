/**
 * Explore filter options: authoritative server sources with explicit failure.
 *
 * Order (Phase 0B.2):
 *   1. `explore_filter_options` materialized view — fast path (<50 ms).
 *   2. Split per-source RPCs (053) — automatic fallback when the view is
 *      unavailable, empty, malformed, or fails.
 *   3. Neither → ExploreFilterOptionsError. There is no client-paged scan:
 *      it capped at 5,000 of ~67,663 cards and returned a partial list as if
 *      it were complete.
 *
 * Specialty / Action / Pose come only from the view's tcg row
 * (`facets_version` >= 1). When that is missing (view unavailable, or the
 * facets migration not applied yet) only those three degrade: curated static
 * lists plus `facetsStatus.available = false` for a visible notice.
 *
 * I/O is injected so this module stays testable in Node.
 */

import { groupExploreSetsBySource, mergeExploreFilterOptions } from "./mergeExploreFilterOptions.js";

export const EXPLORE_OPTION_SOURCES = ["tcg", "pocket", "custom", "japanese"];
export const EXPLORE_FACETS_VERSION = 1;

/** Known Pokémon TCG specialty subtypes; used only when the server facet source is unavailable. */
export const STATIC_SPECIALTY_OPTIONS = ["ACE SPEC", "Pokémon Tool", "Pokémon Tool F", "Technical Machine"];

export const FACETS_DEGRADED_MESSAGE =
  "Specialty, Action, and Pose filters currently show only the built-in lists; " +
  "values that exist only in the database are missing until the filter options view is refreshed.";

export class ExploreFilterOptionsError extends Error {
  /** @param {string} message @param {string[]} [causes] */
  constructor(message, causes = []) {
    super(message);
    this.name = "ExploreFilterOptionsError";
    this.causes = causes;
  }
}

function errorText(e) {
  return (e && (e.message || e.details)) || String(e);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Case-insensitive union, sorted. The first spelling seen wins, so pass the
 * list whose casing should be kept first.
 */
export function mergeSortedUniqueStrings(existing, additions) {
  const canon = new Map();
  for (const raw of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]) {
    if (raw == null || String(raw).trim() === "") continue;
    const s = String(raw).trim();
    const low = s.toLowerCase();
    if (!canon.has(low)) canon.set(low, s);
  }
  return [...canon.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Validate view rows → { tcg, pocket, custom, japanese } option objects.
 * Throws when the view is empty, a source row is missing, or a row is malformed.
 * A list value may be null (jsonb_agg over zero rows); anything else non-array is malformed.
 */
export function mvRowsToSourceOptions(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("explore_filter_options returned no rows (not refreshed?)");
  }
  const bySource = {};
  for (const row of rows) {
    if (!row || typeof row.source !== "string" || !isPlainObject(row.options)) {
      throw new Error("explore_filter_options row is malformed");
    }
    for (const [key, value] of Object.entries(row.options)) {
      if (key === "facets_version") continue;
      if (value != null && !Array.isArray(value)) {
        throw new Error(`explore_filter_options.${row.source}.${key} is not a list`);
      }
    }
    bySource[row.source] = row.options;
  }
  const missing = EXPLORE_OPTION_SOURCES.filter((s) => !bySource[s]);
  if (missing.length) {
    throw new Error(`explore_filter_options is missing source rows: ${missing.join(", ")}`);
  }
  return bySource;
}

/** Specialty/Action/Pose from the view's tcg row, or null when that source is unavailable. */
export function readExploreFacets(tcgOptions) {
  if (!isPlainObject(tcgOptions)) return null;
  const version = Number(tcgOptions.facets_version);
  if (!Number.isFinite(version) || version < EXPLORE_FACETS_VERSION) return null;
  const facets = {};
  for (const key of ["specialties", "actions", "poses"]) {
    const v = tcgOptions[key];
    if (v != null && !Array.isArray(v)) return null;
    facets[key] = (v || []).filter((x) => x != null && String(x).trim() !== "").map((x) => String(x).trim());
  }
  return facets;
}

function assertSplitRpcOptions(built) {
  if (!isPlainObject(built)) throw new Error("split filter-option RPCs returned no data");
  const missing = EXPLORE_OPTION_SOURCES.filter((s) => !isPlainObject(built[s]));
  if (missing.length) throw new Error(`split filter-option RPCs missing: ${missing.join(", ")}`);
  return built;
}

/**
 * @param {object} io
 * @param {() => Promise<unknown[]>} io.readMaterializedView - rows of { source, options }; throws on error
 * @param {() => Promise<Record<string, object>>} io.readSplitRpcs - built per-source options; throws on any failure
 * @param {() => Promise<unknown[]>} [io.readLiveSets] - `sets` rows with origin; throws on error
 * @param {string[]} [io.staticActions]
 * @param {string[]} [io.staticPoses]
 * @param {(…args: unknown[]) => void} [io.warn]
 */
export async function loadExploreFilterOptions({
  readMaterializedView,
  readSplitRpcs,
  readLiveSets,
  staticActions = [],
  staticPoses = [],
  warn = () => {},
}) {
  const causes = [];
  let sourceOptions = null;
  let optionsSource = null;
  let facets = null;

  try {
    sourceOptions = mvRowsToSourceOptions(await readMaterializedView());
    optionsSource = "materialized_view";
    facets = readExploreFacets(sourceOptions.tcg);
  } catch (e) {
    causes.push(`materialized view: ${errorText(e)}`);
    warn("explore_filter_options materialized view unavailable:", errorText(e), "— trying split RPCs");
  }

  if (!sourceOptions) {
    try {
      sourceOptions = assertSplitRpcOptions(await readSplitRpcs());
      optionsSource = "split_rpc";
    } catch (e) {
      causes.push(`split RPCs: ${errorText(e)}`);
      warn("split filter-option RPCs unavailable:", errorText(e));
    }
  }

  if (!sourceOptions) {
    throw new ExploreFilterOptionsError(
      "Explore filter options could not be loaded from the server. " +
        "Try again in a minute; if it keeps failing, the filter options view or its fallback functions need attention.",
      causes
    );
  }

  const merged = mergeExploreFilterOptions(
    sourceOptions.tcg,
    sourceOptions.pocket,
    sourceOptions.custom,
    sourceOptions.japanese
  );

  // Set metadata is small and changes with every ingest. Read it directly so a
  // stale aggregate cannot hide newly added sets (597532d).
  if (readLiveSets) {
    try {
      const liveSetRows = await readLiveSets();
      if (Array.isArray(liveSetRows)) {
        const setsBySource = groupExploreSetsBySource(liveSetRows);
        merged.setsBySource = setsBySource;
        merged.sets = mergeExploreFilterOptions(
          { sets: setsBySource.tcg },
          { sets: setsBySource.pocket },
          { sets: setsBySource.custom },
          { sets: setsBySource.japanese }
        ).sets;
      }
    } catch (e) {
      warn("live Explore set options read failed:", errorText(e), `— using ${optionsSource} set options`);
    }
  }

  // Stored values go first so their exact casing is kept: the Action/Pose
  // filters use case-sensitive JSONB containment.
  if (facets) {
    merged.specialties = mergeSortedUniqueStrings(facets.specialties, []);
    merged.actions = mergeSortedUniqueStrings(facets.actions, staticActions);
    merged.poses = mergeSortedUniqueStrings(facets.poses, staticPoses);
    merged.facetsStatus = { available: true };
  } else {
    merged.specialties = mergeSortedUniqueStrings(STATIC_SPECIALTY_OPTIONS, []);
    merged.actions = mergeSortedUniqueStrings(staticActions, []);
    merged.poses = mergeSortedUniqueStrings(staticPoses, []);
    merged.facetsStatus = { available: false, message: FACETS_DEGRADED_MESSAGE };
  }
  merged.optionsSource = optionsSource;
  return merged;
}
