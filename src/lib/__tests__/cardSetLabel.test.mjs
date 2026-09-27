import test from "node:test";
import assert from "node:assert/strict";
import { cardSetLabel, cardSetLine } from "../cardSetLabel.js";

test("set name wins when recorded", () => {
  assert.deepEqual(cardSetLabel({ setName: "Journey Together", setId: "sv9" }), { label: "Journey Together", named: true });
});

test("missing or blank set name falls back to the upper-cased set code", () => {
  // ptcgdb-sv9-40: set_name NULL, set_id "sv9".
  assert.deepEqual(cardSetLabel({ setName: null, setId: "sv9" }), { label: "SV9", named: false });
  assert.deepEqual(cardSetLabel({ setName: "  ", setId: "bw1-bb" }), { label: "BW1-BB", named: false });
  assert.deepEqual(cardSetLabel({}), { label: "", named: false });
});

test("set line has no empty brackets or separators", () => {
  assert.equal(cardSetLine({ setName: null, setId: "sv9", series: null, number: "040" }), "SV9 · #040");
  assert.equal(cardSetLine({ setName: "Neo Destiny", setId: "neo4", series: "Neo", number: "34" }), "Neo Destiny (Neo) · #34");
  assert.equal(cardSetLine({ setName: "Base", series: "", number: null }), "Base");
  assert.equal(cardSetLine({}), "");
});
