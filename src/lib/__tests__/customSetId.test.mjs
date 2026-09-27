import assert from "node:assert/strict";
import test from "node:test";

import { acronymSetId, resolveCustomSetId, setIdConflict, slugSetId } from "../customSetId.js";

const SETS = [
  { id: "bd", name: "Bd: Battle Starter Deck (Torterra)", origin: "ptcgdb" },
  { id: "sd", name: "SD: V Starter Decks", origin: "ptcgdb" },
  { id: "cd", name: "Chikorita Deck", origin: "manual" },
  { id: "custom-bulbasaur-deck", name: "Bulbasaur Deck", origin: "manual" },
  { id: "xjp", name: "XY Japanese Promos", origin: "manual" },
  { id: "custom-jp-promos-xy", name: "XY Japanese Promos", origin: "manual" },
  { id: "sv9", name: "Journey Together", origin: "pokemontcg.io" },
];

test("acronym keeps the legacy derivation", () => {
  assert.equal(acronymSetId("Test Set Name, Set 4"), "tsns4");
  assert.equal(acronymSetId("Bulbasaur Deck"), "bd");
  assert.equal(acronymSetId("  "), "");
});

test("slug is prefixed and ASCII", () => {
  assert.equal(slugSetId("Bulbasaur Deck"), "custom-bulbasaur-deck");
  assert.equal(slugSetId("Pokémon Café: Mix!"), "custom-pokemon-cafe-mix");
  assert.equal(slugSetId("ポケモン"), "");
});

test("an existing custom set with the same name is reused", () => {
  assert.deepEqual(resolveCustomSetId("bulbasaur deck ", SETS), { setId: "custom-bulbasaur-deck", existing: true });
  assert.deepEqual(resolveCustomSetId("Chikorita Deck", SETS), { setId: "cd", existing: true });
});

test("among same-named custom sets the acronym ID wins", () => {
  assert.deepEqual(resolveCustomSetId("XY Japanese Promos", SETS), { setId: "xjp", existing: true });
});

test("an acronym owned by a differently named set falls back to a slug", () => {
  assert.deepEqual(resolveCustomSetId("Squirtle Deck", SETS), { setId: "custom-squirtle-deck", existing: false });
  assert.deepEqual(resolveCustomSetId("Charmander Deck", SETS), { setId: "custom-charmander-deck", existing: false });
});

test("a taken slug gets a numeric suffix", () => {
  const sets = [...SETS, { id: "custom-squirtle-deck", name: "Something else", origin: "manual" }];
  assert.deepEqual(resolveCustomSetId("Squirtle Deck", sets), { setId: "custom-squirtle-deck-2", existing: false });
});

test("a free acronym is kept for a new set", () => {
  assert.deepEqual(resolveCustomSetId("Great Encounters Box", SETS), { setId: "geb", existing: false });
  assert.deepEqual(resolveCustomSetId("Great Encounters Box", []), { setId: "geb", existing: false });
});

test("conflict reports the set that already owns the ID", () => {
  assert.deepEqual(setIdConflict("bd", "Bulbasaur Deck", SETS), {
    id: "bd",
    name: "Bd: Battle Starter Deck (Torterra)",
    origin: "ptcgdb",
  });
  assert.equal(setIdConflict("sv9", "journey together", SETS), null);
  assert.equal(setIdConflict("new-id", "Anything", SETS), null);
  assert.equal(setIdConflict("", "Anything", SETS), null);
});
