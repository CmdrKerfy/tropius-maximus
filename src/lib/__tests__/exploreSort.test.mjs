import test from "node:test";
import assert from "node:assert/strict";
import { effectiveSortBy, isSortSupported } from "../exploreSort.js";

test("Supabase hides sorts it cannot run and reports them as name", () => {
  for (const key of ["pokedex", "price", "region"]) {
    assert.equal(isSortSupported(key, { supabase: true }), false);
    assert.equal(effectiveSortBy(key, { supabase: true }), "name");
  }
});

test("Supabase keeps the sorts its adapter maps", () => {
  for (const key of ["name", "number", "hp", "rarity", "set_name", "recent"]) {
    assert.equal(isSortSupported(key, { supabase: true }), true);
    assert.equal(effectiveSortBy(key, { supabase: true }), key);
  }
});

test("DuckDB keeps every sort", () => {
  for (const key of ["pokedex", "price", "region", "name"]) {
    assert.equal(effectiveSortBy(key, { supabase: false }), key);
  }
});

test("empty sort falls back to name", () => {
  assert.equal(effectiveSortBy("", { supabase: true }), "name");
  assert.equal(effectiveSortBy(undefined, { supabase: false }), "name");
});
