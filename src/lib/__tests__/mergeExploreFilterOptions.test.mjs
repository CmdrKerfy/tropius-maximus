import assert from "node:assert/strict";
import test from "node:test";

import {
  groupExploreSetsBySource,
} from "../mergeExploreFilterOptions.js";
import {
  applyExploreSetIdFilter,
  normalizeExploreSetIds,
} from "../exploreSetFilter.js";

test("groups live set rows into the Explore source buckets", () => {
  const grouped = groupExploreSetsBySource([
    { id: "me55", name: "30th Celebration", series: "Mega Evolution", origin: "pokemontcg.io" },
    { id: "B2a", name: "Paldean Wonders", series: "tcgp", origin: "tcgdex" },
    { id: "SV11W", name: "White Flare", series: "Scarlet & Violet", origin: "tcgdex" },
    { id: "custom-1", name: "Custom Set", series: null, origin: "manual" },
    { id: "ptcg-1", name: "PTCG Set", series: null, origin: "ptcgdb" },
  ]);

  assert.deepEqual(grouped.pocket.map((set) => set.id), ["B2a"]);
  assert.deepEqual(grouped.japanese.map((set) => set.id), ["ptcg-1", "SV11W"]);
  assert.deepEqual(grouped.custom.map((set) => set.id), ["custom-1"]);
  assert.deepEqual(grouped.tcg.map((set) => set.id), ["custom-1", "me55"]);
});

test("ignores malformed rows and uses the id as a missing name", () => {
  const grouped = groupExploreSetsBySource([
    null,
    { id: "", name: "Missing ID", origin: "pokemontcg.io" },
    { id: "B2", name: "", series: "tcgp", origin: "tcgdex" },
  ]);

  assert.deepEqual(grouped.pocket, [{ id: "B2", name: "B2", series: "tcgp" }]);
});

test("normalizes one TCG set ID for indexed filtering", () => {
  assert.deepEqual(normalizeExploreSetIds(["me55"]), ["me55"]);
});

test("preserves a case-sensitive Pocket set ID", () => {
  assert.deepEqual(normalizeExploreSetIds(["B2a"]), ["B2a"]);
});

test("normalizes and deduplicates multiple selected set IDs", () => {
  assert.deepEqual(
    normalizeExploreSetIds([" me55 ", "B2a", "me55", "", null]),
    ["me55", "B2a"]
  );
});

test("leaves punctuation escaping to Supabase's typed in filter", () => {
  const calls = [];
  const query = {
    in(column, values) {
      calls.push({ column, values });
      return this;
    },
  };

  assert.equal(applyExploreSetIdFilter(query, ['set,one', 'set"two']), query);
  assert.deepEqual(calls, [
    { column: "set_id", values: ['set,one', 'set"two'] },
  ]);
});

test("does not add a filter when no valid set IDs are selected", () => {
  const query = {
    in() {
      assert.fail("empty set selections must not call query.in");
    },
  };

  assert.equal(applyExploreSetIdFilter(query, ["", null, "  "]), query);
});
