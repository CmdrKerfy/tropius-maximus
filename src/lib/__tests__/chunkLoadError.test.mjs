import test from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, reloadForChunkError, CHUNK_RELOAD_GUARD_MS } from "../chunkLoadError.js";

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};

test("browser chunk load messages are detected", () => {
  // Firefox (the production report), Chrome, Safari, Vite CSS preload, webpack-style.
  assert.equal(isChunkLoadError(new TypeError(
    "error loading dynamically imported module: https://tropius-maximus.vercel.app/assets/CardDetail-0w3cM7_z.js")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/x.js")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css")), true);
  assert.equal(isChunkLoadError({ name: "ChunkLoadError", message: "" }), true);
});

test("ordinary errors are not chunk errors", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch")), false);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("reloads once, then not again inside the guard window", () => {
  const storage = memoryStorage();
  let reloads = 0;
  const reload = () => { reloads += 1; };
  assert.equal(reloadForChunkError({ storage, now: 1_000_000, reload }), true);
  assert.equal(reloadForChunkError({ storage, now: 1_000_000 + CHUNK_RELOAD_GUARD_MS - 1, reload }), false);
  assert.equal(reloads, 1);
});

test("reloads again after the guard window (a later deploy in the same tab)", () => {
  const storage = memoryStorage({ tm_chunk_reload_at: "1000000" });
  let reloads = 0;
  assert.equal(reloadForChunkError({ storage, now: 1_000_000 + CHUNK_RELOAD_GUARD_MS, reload: () => { reloads += 1; } }), true);
  assert.equal(reloads, 1);
});

test("no reload when storage is unavailable (cannot guard against a loop)", () => {
  let reloads = 0;
  const reload = () => { reloads += 1; };
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
  assert.equal(reloadForChunkError({ storage: throwing, now: 1, reload }), false);
  assert.equal(reloadForChunkError({ storage: null, now: 1, reload }), false);
  assert.equal(reloads, 0);
});
