import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, buildUrlParams, readUrlStateFromSearch } from "../exploreUrlState.js";
import { exploreFiltersAreActive } from "../exploreFilterSummary.js";

test("Has Image filter round-trips through the URL", () => {
  for (const value of ["true", "false"]) {
    const params = buildUrlParams({ ...DEFAULT_FILTERS, has_image: value }, "", 1, null);
    assert.equal(params.get("has_image"), value);
    assert.equal(readUrlStateFromSearch(`?${params}`).urlFilters.has_image, value);
  }
});

test("Has Image 'All' stays out of the URL and does not count as an active filter", () => {
  const params = buildUrlParams({ ...DEFAULT_FILTERS }, "", 1, null);
  assert.equal(params.has("has_image"), false);
  assert.equal(exploreFiltersAreActive({ ...DEFAULT_FILTERS }), false);
  assert.equal(exploreFiltersAreActive({ ...DEFAULT_FILTERS, has_image: "false" }), true);
});
