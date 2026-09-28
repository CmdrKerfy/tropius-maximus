import test from "node:test";
import assert from "node:assert/strict";
import {
  POKUMON_ARCHIVE_FIELDS_BY_LABEL,
  applyPokumonArchiveFilter,
  isPokumonArchiveFilterKey,
  pokumonArchiveFilterLabel,
  pokumonArchiveValues,
} from "../pokumonArchiveFilter.js";

function fakeQuery() {
  const calls = [];
  const q = {
    calls,
    contains(col, val) {
      calls.push([col, val]);
      return q;
    },
  };
  return q;
}

test("Card Detail labels map to raw_data keys and back", () => {
  assert.equal(POKUMON_ARCHIVE_FIELDS_BY_LABEL["Release event"], "release_event");
  assert.equal(POKUMON_ARCHIVE_FIELDS_BY_LABEL["Release type"], "release_type");
  assert.equal(pokumonArchiveFilterLabel("release_type"), "Release type");
  assert.ok(isPokumonArchiveFilterKey("holofoil"));
  assert.ok(!isPokumonArchiveFilterKey("name"));
  assert.ok(!isPokumonArchiveFilterKey("__proto__"));
});

test("values keep whole list items (commas are not split)", () => {
  assert.deepEqual(pokumonArchiveValues(["Pokémon Center, Tokyo", " 2013 ", "", null]), [
    "Pokémon Center, Tokyo",
    "2013",
  ]);
  assert.deepEqual(pokumonArchiveValues("Bundle Promo"), ["Bundle Promo"]);
  assert.deepEqual(pokumonArchiveValues(undefined), []);
});

test("filter uses jsonb containment on raw_data", () => {
  const q = fakeQuery();
  applyPokumonArchiveFilter(q, "release_event", " Sylveon Collection ");
  assert.deepEqual(q.calls, [["raw_data", { release_event: ["Sylveon Collection"] }]]);
});

test("unknown key or empty value leaves the query unchanged", () => {
  const q = fakeQuery();
  applyPokumonArchiveFilter(q, "name", "x");
  applyPokumonArchiveFilter(q, "release_type", "  ");
  assert.deepEqual(q.calls, []);
});
