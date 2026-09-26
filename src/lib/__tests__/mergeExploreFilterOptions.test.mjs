import assert from "node:assert/strict";
import test from "node:test";

import { groupExploreSetsBySource } from "../mergeExploreFilterOptions.js";

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
