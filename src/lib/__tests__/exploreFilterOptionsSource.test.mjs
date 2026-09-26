import assert from "node:assert/strict";
import test from "node:test";

import {
  ExploreFilterOptionsError,
  FACETS_DEGRADED_MESSAGE,
  STATIC_SPECIALTY_OPTIONS,
  loadExploreFilterOptions,
  mergeSortedUniqueStrings,
  mvRowsToSourceOptions,
} from "../exploreFilterOptionsSource.js";

const STATIC_ACTIONS = ["Jumping", "Running", "Swimming"];
const STATIC_POSES = ["Arms Crossed", "Jumping"];
const LIVE_SPECIALTIES = ["ACE SPEC", "Pokémon Tool", "Pokémon Tool F", "Technical Machine"];

function mvRows({ facets = true, tcgExtra = {} } = {}) {
  const tcg = {
    supertypes: ["Pokémon", "Trainer"],
    rarities: ["Common", "Rare"],
    sets: [{ id: "me55", name: "30th Celebration", series: "Mega Evolution" }],
    artists: ["Ken Sugimori"],
    regions: ["Kanto"],
    generations: [1],
    colors: ["Red"],
    evolution_lines: [],
    background_pokemon: ["Pikachu"],
    weathers: ["Sunny"],
    environments: ["Forest"],
    card_types: [],
    elements: [],
    stages: [],
    trainer_types: [],
    specialties: facets ? LIVE_SPECIALTIES : [],
    actions: facets ? ["attacking", "jumping"] : [],
    poses: facets ? ["Arms Overhead", "arms crossed"] : [],
    ...(facets ? { facets_version: 1 } : {}),
    ...tcgExtra,
  };
  return [
    { source: "tcg", options: tcg },
    { source: "pocket", options: { rarities: ["◊"], sets: [{ id: "B2a", name: "Paldean Wonders", series: "tcgp" }], card_types: ["Pokemon"] } },
    { source: "custom", options: { rarities: null, sets: null, artists: null } },
    { source: "japanese", options: { rarities: ["RR"], sets: [{ id: "SV11W", name: "White Flare", series: "SV" }] } },
  ];
}

function rpcBuilt() {
  const base = { supertypes: [], rarities: [], sets: [], regions: [], generations: [], colors: [], artists: [], evolution_lines: [], trainer_types: [], specialties: [], background_pokemon: [], card_types: [], elements: [], stages: [], weathers: [], environments: [], actions: [], poses: [] };
  return {
    tcg: { ...base, supertypes: ["Pokémon"], rarities: ["Common"], sets: [{ id: "me55", name: "30th Celebration", series: "Mega Evolution" }], artists: ["Ken Sugimori"], weathers: ["Sunny"], actions: STATIC_ACTIONS, poses: STATIC_POSES },
    pocket: { ...base, rarities: ["◊"], sets: [{ id: "B2a", name: "Paldean Wonders", series: "tcgp" }] },
    custom: { ...base },
    japanese: { ...base, rarities: ["RR"] },
  };
}

function io(overrides = {}) {
  const calls = { mv: 0, rpc: 0, sets: 0 };
  const cfg = {
    readMaterializedView: async () => { calls.mv += 1; return mvRows(); },
    readSplitRpcs: async () => { calls.rpc += 1; return rpcBuilt(); },
    readLiveSets: async () => {
      calls.sets += 1;
      return [
        { id: "me55", name: "30th Celebration", series: "Mega Evolution", origin: "pokemontcg.io" },
        { id: "B2b", name: "Newest Pocket Set", series: "tcgp", origin: "tcgdex" },
      ];
    },
    staticActions: STATIC_ACTIONS,
    staticPoses: STATIC_POSES,
    ...overrides,
  };
  return { cfg, calls };
}

test("Specialty lists the live card subtype values from the view", async () => {
  const { cfg } = io();
  const out = await loadExploreFilterOptions(cfg);
  assert.deepEqual(out.specialties, ["ACE SPEC", "Pokémon Tool", "Pokémon Tool F", "Technical Machine"]);
  assert.deepEqual(out.facetsStatus, { available: true });
});

test("database-only Action and Pose values are kept alongside the curated lists", async () => {
  const { cfg } = io();
  const out = await loadExploreFilterOptions(cfg);
  assert.ok(out.actions.includes("attacking"));
  assert.ok(out.poses.includes("Arms Overhead"));
  for (const s of STATIC_ACTIONS) assert.ok(out.actions.some((a) => a.toLowerCase() === s.toLowerCase()), s);
  for (const s of STATIC_POSES) assert.ok(out.poses.some((p) => p.toLowerCase() === s.toLowerCase()), s);
});

test("Action/Pose merge dedupes case-insensitively and keeps the stored spelling", async () => {
  const { cfg } = io();
  const out = await loadExploreFilterOptions(cfg);
  assert.equal(out.actions.filter((a) => a.toLowerCase() === "jumping").length, 1);
  assert.ok(out.actions.includes("jumping"), "stored casing wins so containment filters match");
  assert.equal(out.poses.filter((p) => p.toLowerCase() === "arms crossed").length, 1);
  assert.deepEqual(mergeSortedUniqueStrings(["b", "A"], ["a", " B ", "", null, "c"]), ["A", "b", "c"]);
});

test("a healthy view stays the fast path and never calls the split RPCs", async () => {
  const { cfg, calls } = io();
  const out = await loadExploreFilterOptions(cfg);
  assert.equal(out.optionsSource, "materialized_view");
  assert.deepEqual(calls, { mv: 1, rpc: 0, sets: 1 });
  assert.deepEqual(out.rarities, ["◊", "Common", "Rare", "RR"].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
});

for (const [label, readMaterializedView] of [
  ["fails", async () => { throw new Error('relation "public.explore_filter_options" does not exist'); }],
  ["is empty", async () => []],
  ["is malformed", async () => [{ source: "tcg", options: "not-an-object" }]],
  ["is missing a source row", async () => mvRows().filter((r) => r.source !== "japanese")],
  ["has a non-list option", async () => mvRows({ tcgExtra: { rarities: "Common" } })],
]) {
  test(`split RPCs are used automatically when the view ${label}`, async () => {
    const warnings = [];
    const { cfg, calls } = io({ readMaterializedView, warn: (...a) => warnings.push(a.join(" ")) });
    const out = await loadExploreFilterOptions(cfg);
    assert.equal(out.optionsSource, "split_rpc");
    assert.equal(calls.rpc, 1);
    assert.ok(out.rarities.includes("Common"));
    assert.ok(warnings.length >= 1);
  });
}

test("total server failure is an explicit error, not an empty or partial list", async () => {
  const { cfg, calls } = io({
    readMaterializedView: async () => { throw new Error("57014: canceling statement due to statement timeout"); },
    readSplitRpcs: async () => { throw new Error("tcg: Could not find the function public.get_tcg_filter_options_db"); },
  });
  await assert.rejects(loadExploreFilterOptions(cfg), (err) => {
    assert.ok(err instanceof ExploreFilterOptionsError);
    assert.match(err.message, /could not be loaded/);
    assert.equal(err.causes.length, 2);
    assert.match(err.causes[0], /57014/);
    assert.match(err.causes[1], /get_tcg_filter_options_db/);
    return true;
  });
  assert.equal(calls.sets, 0);
});

test("view without the new facets degrades only Specialty/Action/Pose", async () => {
  const { cfg } = io({ readMaterializedView: async () => mvRows({ facets: false }) });
  const out = await loadExploreFilterOptions(cfg);
  assert.equal(out.optionsSource, "materialized_view");
  assert.deepEqual(out.facetsStatus, { available: false, message: FACETS_DEGRADED_MESSAGE });
  assert.deepEqual(out.specialties, [...STATIC_SPECIALTY_OPTIONS].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  assert.deepEqual(out.actions, STATIC_ACTIONS);
  assert.deepEqual(out.poses, STATIC_POSES);
  assert.deepEqual(out.artists, ["Ken Sugimori"]);
  assert.deepEqual(out.weathers, ["Sunny"]);
  assert.ok(out.sets.length > 0);
});

test("split-RPC fallback has no facet source, so only those three degrade", async () => {
  const { cfg } = io({ readMaterializedView: async () => { throw new Error("boom"); } });
  const out = await loadExploreFilterOptions(cfg);
  assert.equal(out.facetsStatus.available, false);
  assert.deepEqual(out.artists, ["Ken Sugimori"]);
  assert.deepEqual(out.actions, STATIC_ACTIONS);
});

test("view and split-RPC paths return the same option contract", async () => {
  const mv = await loadExploreFilterOptions(io().cfg);
  const rpc = await loadExploreFilterOptions(
    io({ readMaterializedView: async () => { throw new Error("boom"); } }).cfg
  );
  assert.deepEqual(Object.keys(mv).sort(), Object.keys(rpc).sort());
  for (const key of ["specialties", "actions", "poses", "sets", "rarities", "artists"]) {
    assert.ok(Array.isArray(mv[key]) && Array.isArray(rpc[key]), key);
  }
  assert.deepEqual(Object.keys(mv.setsBySource).sort(), ["custom", "japanese", "pocket", "tcg"]);
  assert.deepEqual(Object.keys(rpc.setsBySource).sort(), ["custom", "japanese", "pocket", "tcg"]);
});

test("live sets overlay applies on both paths; its failure keeps aggregate sets", async () => {
  const mv = await loadExploreFilterOptions(io().cfg);
  assert.deepEqual(mv.setsBySource.pocket.map((s) => s.id), ["B2b"]);
  assert.ok(mv.sets.some((s) => s.id === "B2b"));

  const rpc = await loadExploreFilterOptions(
    io({ readMaterializedView: async () => { throw new Error("boom"); } }).cfg
  );
  assert.ok(rpc.sets.some((s) => s.id === "B2b"));

  const noLive = await loadExploreFilterOptions(
    io({ readLiveSets: async () => { throw new Error("sets read failed"); } }).cfg
  );
  assert.deepEqual(noLive.setsBySource.pocket.map((s) => s.id), ["B2a"]);
});

test("no successful path truncates option lists at 5,000", async () => {
  const many = Array.from({ length: 6000 }, (_, i) => `Artist ${String(i).padStart(5, "0")}`);
  const mv = await loadExploreFilterOptions(
    io({ readMaterializedView: async () => mvRows({ tcgExtra: { artists: many } }) }).cfg
  );
  assert.equal(mv.artists.length, 6000);

  const rpc = await loadExploreFilterOptions(
    io({
      readMaterializedView: async () => { throw new Error("boom"); },
      readSplitRpcs: async () => {
        const built = rpcBuilt();
        built.tcg.artists = many;
        return built;
      },
    }).cfg
  );
  assert.equal(rpc.artists.length, 6000);
});

test("mvRowsToSourceOptions accepts null lists from empty aggregates", () => {
  const bySource = mvRowsToSourceOptions(mvRows());
  assert.equal(bySource.custom.rarities, null);
  assert.equal(bySource.tcg.facets_version, 1);
});
