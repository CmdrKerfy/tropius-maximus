import test from "node:test";
import assert from "node:assert/strict";
import { isArrowKeyConsumer } from "../keyboardTargets.js";

const el = (props = {}, closestMatch = null) => ({ closest: () => closestMatch, ...props });

test("text fields, selects and textareas consume arrows", () => {
  assert.equal(isArrowKeyConsumer(el({ tagName: "INPUT", type: "text" })), true);
  assert.equal(isArrowKeyConsumer(el({ tagName: "input", type: "" })), true);
  assert.equal(isArrowKeyConsumer(el({ tagName: "INPUT", type: "number" })), true);
  assert.equal(isArrowKeyConsumer(el({ tagName: "TEXTAREA" })), true);
  assert.equal(isArrowKeyConsumer(el({ tagName: "SELECT" })), true);
});

test("checkbox and button inputs do not", () => {
  assert.equal(isArrowKeyConsumer(el({ tagName: "INPUT", type: "checkbox" })), false);
  assert.equal(isArrowKeyConsumer(el({ tagName: "INPUT", type: "button" })), false);
});

test("content-editable and ARIA arrow widgets consume arrows", () => {
  assert.equal(isArrowKeyConsumer(el({ tagName: "DIV", isContentEditable: true })), true);
  assert.equal(isArrowKeyConsumer(el({ tagName: "LI" }, { role: "listbox" })), true);
});

test("plain elements and missing targets do not", () => {
  assert.equal(isArrowKeyConsumer(el({ tagName: "BUTTON" })), false);
  assert.equal(isArrowKeyConsumer(el({ tagName: "DIV" })), false);
  assert.equal(isArrowKeyConsumer(null), false);
  assert.equal(isArrowKeyConsumer({ addEventListener() {} }), false);
});
