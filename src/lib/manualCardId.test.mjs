/**
 * Guard against drift between `manualCardId.js` and Postgres `generate_card_id`.
 * Run: npm run test:manual-id
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildManualCardId, normalizeCardNumberForStorage } from "./manualCardId.js";

describe("normalizeCardNumberForStorage", () => {
  it("strips leading zeros", () => {
    assert.equal(normalizeCardNumberForStorage("007"), "7");
    assert.equal(normalizeCardNumberForStorage("01"), "1");
  });
  it("maps empty to 0", () => {
    assert.equal(normalizeCardNumberForStorage(""), "0");
    assert.equal(normalizeCardNumberForStorage("000"), "0");
  });
  it("trims whitespace", () => {
    assert.equal(normalizeCardNumberForStorage("  12  "), "12");
  });
});

describe("buildManualCardId", () => {
  it("lowercases set id and joins", () => {
    assert.equal(buildManualCardId("Ab", "2"), "custom-ab-2");
  });
  it("matches id segments to normalized number", () => {
    assert.equal(buildManualCardId("x", "09"), "custom-x-9");
  });
  it("throws without set id", () => {
    assert.throws(() => buildManualCardId("", "1"), /Set ID is required/);
  });
});
