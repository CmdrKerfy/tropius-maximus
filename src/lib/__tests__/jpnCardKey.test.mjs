/**
 * Parity tests for jpn_card_key normalization between JS and Python.
 * Both sides must produce identical results for the same inputs.
 * Run: npm run test:jpn-key
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeJpnNumber, buildJpnCardKey } from "../jpnCardKey.js";

// Must match scripts/test_jpn_card_key.py TEST_VECTORS exactly.
const TEST_VECTORS = [
  ["1", "1"],
  ["001", "1"],
  ["001a", "1A"],
  ["173/SR", "173SR"],
  ["173 SR", "173SR"],
  ["GG70", "GG70"],
  ["SM-P", "SM-P"],
  ["0", "0"],
  ["000", "0"],
  ["", "0"],
  [null, "0"],
  ["  173/SR  ", "173SR"],
];

describe("normalizeJpnNumber", () => {
  for (const [input, expected] of TEST_VECTORS) {
    it(`normalizes ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeJpnNumber(input), expected);
    });
  }
});

describe("buildJpnCardKey", () => {
  it("builds a key from set_id and number", () => {
    assert.equal(buildJpnCardKey("SM12a", "001a"), "sm12a:1A");
  });

  it("returns null for null set_id", () => {
    assert.equal(buildJpnCardKey(null, "1"), null);
  });

  it("returns null for undefined set_id", () => {
    assert.equal(buildJpnCardKey(undefined, "1"), null);
  });

  it("lowercases the set_id", () => {
    assert.equal(buildJpnCardKey("SM12A", "1"), "sm12a:1");
  });
});
