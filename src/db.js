/**
 * db.js — DuckDB-WASM + IndexedDB database layer.
 *
 * Exports the exact same function signatures as the original api.js
 * so all React components work unchanged. Data comes from static
 * Parquet files loaded into an in-memory DuckDB-WASM instance.
 * User annotations and custom attributes persist in IndexedDB.
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import {
  ART_STYLE_OPTIONS, CAMERA_ANGLE_OPTIONS, EMOTION_OPTIONS, ACTIONS_OPTIONS,
  POSE_OPTIONS, ITEMS_OPTIONS, ADDITIONAL_CHARACTERS_OPTIONS, PERSPECTIVE_OPTIONS,
  WEATHER_OPTIONS, ENVIRONMENT_OPTIONS, CARD_LOCATIONS_OPTIONS, BACKGROUND_DETAILS_OPTIONS,
  PKMN_REGION_OPTIONS, CARD_SUBCATEGORY_OPTIONS, HELD_ITEM_OPTIONS, POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS, BERRIES_OPTIONS, HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS, TRAINER_CARD_TYPE_OPTIONS, TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS, VIDEO_REGION_OPTIONS, VIDEO_LOCATION_OPTIONS,
  STAMP_OPTIONS,
  CARD_BORDER_OPTIONS, ENERGY_TYPE_OPTIONS, RIVAL_GROUP_OPTIONS,
} from "./lib/annotationOptions.js";
// Local worker + WASM (main thread fetches WASM, passes blob URL to worker so worker never does CDN/path fetch)
import duckdb_wasm_mvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

// ── Module-level state ─────────────────────────────────────────────────

let db = null;
let conn = null;
let initialized = false;

/** Turn relative path/URL into absolute URL so the worker can fetch WASM (Request requires valid URL). */
function toAbsoluteUrl(url) {
  if (typeof url !== "string") return url;
  if (/^(https?:|blob:)/.test(url)) return url;
  const base = typeof location !== "undefined" ? location.origin + (import.meta.env.BASE_URL || "/") : "";
  return new URL(url, base).href;
}

// ── Unicode helpers ─────────────────────────────────────────────────────

function encodeUnicode(str) {
  return str.replace(/[^\x00-\x7F]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

// ── Checksum ────────────────────────────────────────────────────────────

async function computeChecksum(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Array normalisation ─────────────────────────────────────────────────

function normalizeToArray(val) {
  if (val === null || val === undefined) return null;
  // Recursively unwrap JSON-array strings (handles arbitrary levels of double-encoding)
  let current = val;
  for (let i = 0; i < 10; i++) {
    if (Array.isArray(current)) {
      // If every element is a plain string (not a JSON array), we're done
      if (current.every(el => typeof el !== 'string' || !el.startsWith('['))) break;
      // Unwrap single-element array containing a JSON array string
      if (current.length === 1 && typeof current[0] === 'string' && current[0].startsWith('[')) {
        try {
          const inner = JSON.parse(current[0]);
          if (Array.isArray(inner)) { current = inner; continue; }
        } catch { /* keep */ }
      }
      break;
    }
    if (typeof current === 'string' && current !== '') {
      if (current.startsWith('[')) {
        try {
          const parsed = JSON.parse(current);
          if (Array.isArray(parsed)) { current = parsed; continue; }
        } catch { /* not a JSON array */ }
      }
      return [current];
    }
    return null;
  }
  if (Array.isArray(current)) return current;
  if (typeof current === 'string' && current !== '') return [current];
  return null;
}

// ── IndexedDB helpers ──────────────────────────────────────────────────

const IDB_NAME = "pokemon-tcg";
const IDB_VERSION = 2;
const STORE_ANNOTATIONS = "annotations";
const STORE_ATTRIBUTES = "attributes";
const STORE_CUSTOM_CARDS = "custom_cards";
const STORE_CUSTOM_SETS = "custom_sets";

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_ANNOTATIONS)) {
        idb.createObjectStore(STORE_ANNOTATIONS, { keyPath: "id" });
      }
      if (!idb.objectStoreNames.contains(STORE_ATTRIBUTES)) {
        idb.createObjectStore(STORE_ATTRIBUTES, { keyPath: "key" });
      }
      if (!idb.objectStoreNames.contains(STORE_CUSTOM_CARDS)) {
        idb.createObjectStore(STORE_CUSTOM_CARDS, { keyPath: "id" });
      }
      if (!idb.objectStoreNames.contains(STORE_CUSTOM_SETS)) {
        idb.createObjectStore(STORE_CUSTOM_SETS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return openIDB().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(storeName, value) {
  return openIDB().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.put(value);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDelete(storeName, key) {
  return openIDB().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

function idbClearStore(storeName) {
  return openIDB().then(
    (idb) =>
      new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

// ── SQL escape helpers ─────────────────────────────────────────────────

function escapeStr(s) {
  if (s == null || s === undefined) return "''";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** For JSON columns only: never emit empty string (invalid JSON). Use '{}' as minimum. */
function escapeJson(val) {
  let s = "{}";
  if (val != null && typeof val === "object") {
    try {
      const raw = JSON.stringify(val);
      if (raw && raw.length > 0) s = raw;
    } catch (_) { /* keep '{}' */ }
  }
  return "'" + s.replace(/'/g, "''") + "'";
}

/** Parse string from JSON column; empty string is invalid JSON, so return fallback. */
function safeParseJson(val, fallback = {}) {
  if (val == null) return fallback;
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (trimmed.length === 0) return fallback;
  try {
    return JSON.parse(val);
  } catch (_) {
    return fallback;
  }
}

// Generate SQL IN/= clause for a multi-value filter array, or null if empty.
function inSQL(vals, col) {
  if (!Array.isArray(vals) || vals.length === 0) return null;
  if (vals.length === 1) return `${col} = ${escapeStr(vals[0])}`;
  return `${col} IN (${vals.map(escapeStr).join(", ")})`;
}

// ── TCGdex image URL helpers ──────────────────────────────────────────

// SQL CASE expression to map our set_id to TCGdex set IDs
const TCGDEX_SET_EXPR = `(CASE WHEN pc.set_id = 'PROMO-A' THEN 'P-A'
       WHEN pc.set_id = 'PROMO-B' THEN 'P-B'
       ELSE pc.set_id END)`;

const TCGDEX_IMG_BASE = `'https://assets.tcgdex.net/en/tcgp/' || ${TCGDEX_SET_EXPR} || '/' || LPAD(CAST(pc.number AS VARCHAR), 3, '0')`;
const TCGDEX_IMG_SMALL = `${TCGDEX_IMG_BASE} || '/low.webp'`;
const TCGDEX_IMG_LARGE = `${TCGDEX_IMG_BASE} || '/high.webp'`;

// ── Custom source tracking ──────────────────────────────────────────────

let customSourceNames = new Set();

export function getCustomSourceNames() {
  return [...customSourceNames].sort();
}

// Promoted annotation column names (array-valued ones stored as JSON strings)
const PROMOTED_ARRAY_FIELDS = new Set([
  "art_style","main_character","background_pokemon","background_humans",
  "additional_characters","background_details",
  "card_subcategory","evolution_items","berries","holiday_theme","multi_card","trainer_card_subgroup",
  "video_type","video_region","video_location",
  "items","held_item","pokeball",
  "emotion","pose","actions",
]);

const PROMOTED_STRING_FIELDS = [
  "camera_angle","perspective",
  "weather","environment","storytelling","card_locations","pkmn_region","card_region",
  "primary_color","secondary_color","shape",
  "video_game","video_game_location","video_url","video_title","unique_id","notes","evolution_line",
  "trainer_card_type","stamp","card_border","energy_type","rival_group",
  "image_override","top_10_themes","wtpc_episode",
];

const PROMOTED_BOOL_FIELDS = ["video_appearance","shorts_appearance","region_appearance","thumbnail_used","owned","pocket_exclusive"];

// All promoted field names as a flat Set (for quick lookup)
const ALL_PROMOTED_FIELDS = new Set([...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS]);

/**
 * Build an annotations-like object from promoted tcg_cards/pocket_cards columns.
 * Skips empty/null/false values.
 */
function buildPromotedAnnotations(row) {
  const result = {};
  for (const key of PROMOTED_ARRAY_FIELDS) {
    const val = row[key];
    if (!val) continue;
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr) && arr.length > 0) result[key] = arr;
    } catch {
      if (val) result[key] = val;
    }
  }
  for (const key of PROMOTED_STRING_FIELDS) {
    let val = row[key];
    if (!val) continue;
    // Normalize: if stored as JSON array string (e.g. '["Sweat"]'), parse so UI gets array
    const trimmed = typeof val === "string" ? val.trim() : val;
    if (typeof trimmed === "string" && trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          val = parsed;
        }
      } catch { /* keep original val */ }
    }
    result[key] = val;
  }
  for (const key of PROMOTED_BOOL_FIELDS) {
    if (row[key] === true) result[key] = true;
  }
  return result;
}

/**
 * Build a SQL SET clause for updating promoted annotation columns.
 * Returns a comma-separated string like "emotion = 'Happy', owned = true"
 * or empty string if no promoted fields are present.
 */
function buildPromotedSetClause(data) {
  const updates = [];
  for (const [key, value] of Object.entries(data)) {
    if (!ALL_PROMOTED_FIELDS.has(key)) continue;
    if (PROMOTED_BOOL_FIELDS.includes(key)) {
      updates.push(`${key} = ${value === true}`);
    } else {
      const str = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
      updates.push(`${key} = ${escapeStr(str)}`);
    }
  }
  return updates.join(', ');
}

// ── Initialization ─────────────────────────────────────────────────────

/**
 * Initialize DuckDB-WASM, load Parquet data, create annotation/attribute
 * tables, and hydrate user data from IndexedDB.
 */
export async function initDB() {
  if (initialized) return;

  const MANUAL_BUNDLES = {
    mvp: { mainModule: duckdb_wasm_mvp, mainWorker: mvp_worker },
    eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
  };
  const bundles = import.meta.env.DEV ? { mvp: MANUAL_BUNDLES.mvp } : MANUAL_BUNDLES;
  const bundle = await duckdb.selectBundle(bundles);

  const wasmUrl = toAbsoluteUrl(bundle.mainModule);
  let wasmBlobUrl;
  try {
    const wasmBuf = await fetch(wasmUrl).then((r) => r.arrayBuffer());
    wasmBlobUrl = URL.createObjectURL(new Blob([wasmBuf], { type: "application/wasm" }));
  } catch (e) {
    throw new Error("DuckDB init: failed to fetch WASM — " + (e?.message || e));
  }

  let workerBlobUrl;
  const mainWorkerUrl = toAbsoluteUrl(bundle.mainWorker);
  if (import.meta.env.DEV) {
    try {
      const workerScript = await fetch(mainWorkerUrl).then((r) => r.text());
      const scriptWithoutSourcemap = workerScript.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
      workerBlobUrl = URL.createObjectURL(
        new Blob([scriptWithoutSourcemap], { type: "application/javascript" })
      );
    } catch (e) {
      URL.revokeObjectURL(wasmBlobUrl);
      throw new Error("DuckDB init: failed to fetch worker (dev) — " + (e?.message || e));
    }
  } else {
    let workerScript;
    try {
      workerScript = await fetch(mainWorkerUrl).then((r) => r.text());
    } catch (e) {
      URL.revokeObjectURL(wasmBlobUrl);
      throw new Error("DuckDB init: failed to fetch worker script — " + (e?.message || e));
    }
    const scriptWithoutSourcemap = workerScript.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
    workerBlobUrl = URL.createObjectURL(
      new Blob([scriptWithoutSourcemap], { type: "application/javascript" })
    );
  }
  const worker = new Worker(workerBlobUrl, { type: "classic" });
  URL.revokeObjectURL(workerBlobUrl);

  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  try {
    await db.instantiate(wasmBlobUrl, null);
  } catch (e) {
    URL.revokeObjectURL(wasmBlobUrl);
    throw new Error("DuckDB init: " + (e?.message || e));
  }
  URL.revokeObjectURL(wasmBlobUrl);

  try {
    conn = await db.connect();
  } catch (e) {
    throw new Error("DuckDB init: connect failed — " + (e?.message || e));
  }

  try {
    // 2. Fetch Parquet files and register them
    const base = import.meta.env.BASE_URL || "/";
  const [cardsResp, setsResp, pokemonMetaResp, pocketCardsResp, pocketSetsResp, customCardsResp] = await Promise.all([
    fetch(`${base}data/cards.parquet`),
    fetch(`${base}data/sets.parquet`),
    fetch(`${base}data/pokemon_metadata.parquet`),
    fetch(`${base}data/pocket_cards.parquet`),
    fetch(`${base}data/pocket_sets.parquet`),
    fetch(`${base}data/custom_cards.json?v=${import.meta.env.VITE_BUILD_DATE || "dev"}`),
  ]);

  if (!cardsResp.ok) throw new Error("Failed to fetch cards.parquet");
  if (!setsResp.ok) throw new Error("Failed to fetch sets.parquet");

  const cardsBuf = new Uint8Array(await cardsResp.arrayBuffer());
  const setsBuf = new Uint8Array(await setsResp.arrayBuffer());

  await db.registerFileBuffer("cards.parquet", cardsBuf);
  await db.registerFileBuffer("sets.parquet", setsBuf);

  // Register pokemon_metadata if available
  if (pokemonMetaResp.ok) {
    const pokemonBuf = new Uint8Array(await pokemonMetaResp.arrayBuffer());
    await db.registerFileBuffer("pokemon_metadata.parquet", pokemonBuf);
  }

  // Helper: promoted annotation columns DDL (shared between tcg_cards and pocket_cards)
  const PROMOTED_COLS_DDL = `
      image_override         VARCHAR,
      art_style              VARCHAR,
      main_character         VARCHAR,
      background_pokemon     VARCHAR,
      background_humans      VARCHAR,
      additional_characters  VARCHAR,
      evolution_line         VARCHAR,
      background_details     VARCHAR,
      emotion                VARCHAR,
      pose                   VARCHAR,
      actions                VARCHAR,
      camera_angle           VARCHAR,
      perspective            VARCHAR,
      primary_color          VARCHAR,
      secondary_color        VARCHAR,
      storytelling           VARCHAR,
      weather                VARCHAR,
      environment            VARCHAR,
      card_region            VARCHAR,
      card_locations         VARCHAR,
      pkmn_region            VARCHAR,
      items                  VARCHAR,
      held_item              VARCHAR,
      pokeball               VARCHAR,
      evolution_items        VARCHAR,
      berries                VARCHAR,
      card_subcategory       VARCHAR,
      trainer_card_type      VARCHAR,
      trainer_card_subgroup  VARCHAR,
      stamp                  VARCHAR,
      card_border            VARCHAR,
      energy_type            VARCHAR,
      rival_group            VARCHAR,
      holiday_theme          VARCHAR,
      multi_card             VARCHAR,
      shape                  VARCHAR,
      video_game             VARCHAR,
      video_game_location    VARCHAR,
      video_appearance       BOOLEAN DEFAULT FALSE,
      shorts_appearance      BOOLEAN DEFAULT FALSE,
      region_appearance      BOOLEAN DEFAULT FALSE,
      thumbnail_used         BOOLEAN DEFAULT FALSE,
      video_url              VARCHAR,
      video_title            VARCHAR,
      video_type             VARCHAR,
      video_region           VARCHAR,
      video_location         VARCHAR,
      top_10_themes          VARCHAR,
      wtpc_episode           VARCHAR,
      pocket_exclusive       BOOLEAN DEFAULT FALSE,
      owned                  BOOLEAN DEFAULT FALSE,
      unique_id              VARCHAR,
      notes                  VARCHAR,
      annotations            JSON DEFAULT '{}'`;

  // 3. Create tcg_cards table (unified: API TCG cards + custom TCG cards)
  await conn.query(`
    CREATE OR REPLACE TABLE tcg_cards (
      id              VARCHAR,
      name            VARCHAR,
      supertype       VARCHAR,
      subtypes        VARCHAR,
      hp              VARCHAR,
      types           VARCHAR,
      evolves_from    VARCHAR,
      rarity          VARCHAR,
      artist          VARCHAR,
      set_id          VARCHAR,
      set_name        VARCHAR,
      set_series      VARCHAR,
      number          VARCHAR,
      regulation_mark VARCHAR,
      image_small     VARCHAR,
      image_large     VARCHAR,
      raw_data        JSON,
      prices          JSON,
      special_rarity  VARCHAR,
      alt_name        VARCHAR,
      source          VARCHAR DEFAULT 'TCG',
      is_custom       BOOLEAN DEFAULT FALSE,
      ${PROMOTED_COLS_DDL}
    )
  `);

  // Populate tcg_cards from parquet (API cards: source='TCG', is_custom=FALSE)
  await conn.query(`
    INSERT INTO tcg_cards (
      id, name, supertype, subtypes, hp, types, evolves_from, rarity, artist,
      set_id, set_name, set_series, number, regulation_mark, image_small, image_large,
      raw_data, prices, source, is_custom
    )
    SELECT id, name, supertype, subtypes, hp, types, evolves_from, rarity, artist,
           set_id, set_name, set_series, number, regulation_mark, image_small, image_large,
           raw_data, prices, 'TCG', FALSE
    FROM 'cards.parquet'
  `);

  await conn.query(
    "CREATE OR REPLACE TABLE sets AS SELECT * FROM 'sets.parquet'"
  );

  // Create pokemon_metadata table (empty if parquet not available)
  if (pokemonMetaResp.ok) {
    await conn.query(
      "CREATE OR REPLACE TABLE pokemon_metadata AS SELECT * FROM 'pokemon_metadata.parquet'"
    );
    await conn.query("ALTER TABLE pokemon_metadata ADD COLUMN IF NOT EXISTS shape VARCHAR");
    await conn.query("ALTER TABLE pokemon_metadata ADD COLUMN IF NOT EXISTS genus VARCHAR");
    await conn.query("ALTER TABLE pokemon_metadata ADD COLUMN IF NOT EXISTS encounter_location VARCHAR");
  } else {
    await conn.query(`
      CREATE OR REPLACE TABLE pokemon_metadata (
        pokedex_number INTEGER PRIMARY KEY,
        name           VARCHAR,
        region         VARCHAR,
        generation     INTEGER,
        color          VARCHAR,
        shape          VARCHAR,
        genus          VARCHAR,
        encounter_location VARCHAR,
        evolution_chain VARCHAR
      )
    `);
  }

  // Create pocket_cards table with extended schema (promoted annotation columns)
  if (pocketCardsResp.ok) {
    const pocketCardsBuf = new Uint8Array(await pocketCardsResp.arrayBuffer());
    await db.registerFileBuffer("pocket_cards.parquet", pocketCardsBuf);
    await conn.query(`
      CREATE OR REPLACE TABLE pocket_cards (
        id              VARCHAR,
        name            VARCHAR,
        set_id          VARCHAR,
        number          INTEGER,
        rarity          VARCHAR,
        card_type       VARCHAR,
        element         VARCHAR,
        hp              INTEGER,
        stage           VARCHAR,
        retreat_cost    INTEGER,
        weakness        VARCHAR,
        evolves_from    VARCHAR,
        packs           JSON,
        image_url       VARCHAR,
        image_filename  VARCHAR,
        illustrator     VARCHAR,
        raw_data        JSON,
        is_custom       BOOLEAN DEFAULT FALSE,
        source          VARCHAR DEFAULT 'Pocket',
        ${PROMOTED_COLS_DDL}
      )
    `);
    await conn.query(`
      INSERT INTO pocket_cards (
        id, name, set_id, number, rarity, card_type, element, hp, stage,
        retreat_cost, weakness, evolves_from, packs, image_url, image_filename,
        illustrator, raw_data, is_custom, source
      )
      SELECT id, name, set_id, number, rarity, card_type, element, hp, stage,
             retreat_cost, weakness, evolves_from, packs, image_url, image_filename,
             illustrator, raw_data, FALSE, 'Pocket'
      FROM 'pocket_cards.parquet'
    `);
  } else {
    await conn.query(`
      CREATE OR REPLACE TABLE pocket_cards (
        id              VARCHAR,
        name            VARCHAR,
        set_id          VARCHAR,
        number          INTEGER,
        rarity          VARCHAR,
        card_type       VARCHAR,
        element         VARCHAR,
        hp              INTEGER,
        stage           VARCHAR,
        retreat_cost    INTEGER,
        weakness        VARCHAR,
        evolves_from    VARCHAR,
        packs           JSON,
        image_url       VARCHAR,
        image_filename  VARCHAR,
        illustrator     VARCHAR,
        raw_data        JSON,
        is_custom       BOOLEAN DEFAULT FALSE,
        source          VARCHAR DEFAULT 'Pocket',
        ${PROMOTED_COLS_DDL}
      )
    `);
  }

  // Create pocket_sets table
  if (pocketSetsResp.ok) {
    const pocketSetsBuf = new Uint8Array(await pocketSetsResp.arrayBuffer());
    await db.registerFileBuffer("pocket_sets.parquet", pocketSetsBuf);
    await conn.query(
      "CREATE OR REPLACE TABLE pocket_sets AS SELECT * FROM 'pocket_sets.parquet'"
    );
  } else {
    await conn.query(`
      CREATE OR REPLACE TABLE pocket_sets (
        id            VARCHAR PRIMARY KEY,
        name          VARCHAR,
        series        VARCHAR,
        release_date  VARCHAR,
        card_count    INTEGER,
        packs         JSON,
        logo_url      VARCHAR
      )
    `);
  }

  // Pre-read custom cards JSON (needed for both checksum and parsing)
  let customCardsJson = null;
  let newChecksum = null;
  if (customCardsResp.ok) {
    try {
      const text = await customCardsResp.text();
      newChecksum = await computeChecksum(text);
      customCardsJson = JSON.parse(text);
    } catch (e) {
      console.warn("Could not parse custom_cards.json:", e.message);
    }
  }

  // Load custom cards: use IndexedDB when up-to-date, reload from JSON when checksum changes
  let customCards = [];
  let customCardsFromJson = false;
  try {
    const idbCards = await idbGetAll(STORE_CUSTOM_CARDS);
    const attrs = await idbGetAll(STORE_ATTRIBUTES).catch(() => []);
    const customCardsInitialized = attrs.some((a) => a.key === "custom_cards_initialized");
    const storedChecksum = attrs.find((a) => a.key === "custom_cards_checksum")?.value;
    const checksumChanged = newChecksum !== null && storedChecksum !== newChecksum;

    if (checksumChanged) {
      // JSON file has changed — clear stale IDB cache and reload from JSON
      await idbClearStore(STORE_CUSTOM_CARDS);
      if (customCardsJson) {
        customCards = customCardsJson.cards || [];
        customCardsFromJson = true;
      }
    } else if (idbCards.length > 0) {
      customCards = idbCards;
    } else if (customCardsInitialized) {
      customCards = [];
    } else if (customCardsJson) {
      customCards = customCardsJson.cards || [];
      customCardsFromJson = true;
    }
  } catch (e) {
    if (customCardsJson) {
      customCards = customCardsJson.cards || [];
      customCardsFromJson = true;
    }
  }
  if (customCards.length > 0) {

      // Known column fields for each table (routing/identity fields excluded from JSON blob)
      const tcgColumnFields = new Set([
        "id","name","supertype","subtypes","hp","types","evolves_from",
        "rarity","special_rarity","alt_name","artist","set_id","set_name","set_series","number",
        "regulation_mark","image_small","image_large","source","is_custom","_table",
        ...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS,
      ]);

      const pocketColumnFields = new Set([
        "id","name","set_id","number","rarity","card_type","element","hp","stage",
        "retreat_cost","weakness","evolves_from","packs","image_url","image_filename",
        "illustrator","raw_data","source","is_custom","_table",
        ...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS,
      ]);

      const PROMOTED_COL_NAMES = `
          art_style, main_character, background_pokemon, background_humans,
          additional_characters, evolution_line, background_details,
          emotion, pose, actions, camera_angle, perspective,
          primary_color, secondary_color, storytelling,
          weather, environment, card_region, card_locations, pkmn_region,
          items, held_item, pokeball, evolution_items, berries, card_subcategory,
          trainer_card_type, trainer_card_subgroup, stamp, holiday_theme, multi_card, shape,
          video_game, video_game_location,
          video_appearance, shorts_appearance, region_appearance, thumbnail_used,
          video_url, video_title, video_type, video_region, video_location,
          top_10_themes, wtpc_episode, pocket_exclusive, owned, unique_id, notes,
          image_override, annotations`;

      const uniqueCustomCards = [...new Map(customCards.filter(c => c.id).map(c => [c.id, c])).values()];

      // Build VALUES rows grouped by type, then batch-insert (avoids 600+ individual round-trips)
      const pocketRows = [];
      const tcgRows = [];

      for (const card of uniqueCustomCards) {
        if (!card.id) continue;
        const isPocket = card._table === 'pocket';
        const columnFields = isPocket ? pocketColumnFields : tcgColumnFields;

        const arrayVal = (key) => {
          const arr = normalizeToArray(card[key]);
          return arr ? JSON.stringify(arr) : '';
        };
        const strVal = (key) => card[key] != null ? String(card[key]) : '';
        const boolVal = (key) => card[key] === true;
        const evolutionLine = (() => {
          const arr = normalizeToArray(card.evolution_line);
          return arr ? arr.join(' → ') : '';
        })();

        const annotations = {};
        for (const [k, v] of Object.entries(card)) {
          if (columnFields.has(k)) continue;
          if (v === '' || v === null || v === undefined) continue;
          annotations[k] = v;
        }

        const promotedVals = `
          ${escapeStr(arrayVal('art_style'))}, ${escapeStr(arrayVal('main_character'))},
          ${escapeStr(arrayVal('background_pokemon'))}, ${escapeStr(arrayVal('background_humans'))},
          ${escapeStr(arrayVal('additional_characters'))}, ${escapeStr(evolutionLine)},
          ${escapeStr(arrayVal('background_details'))},
          ${escapeStr(arrayVal('emotion'))}, ${escapeStr(arrayVal('pose'))},
          ${escapeStr(arrayVal('actions'))}, ${escapeStr(strVal('camera_angle'))},
          ${escapeStr(strVal('perspective'))},
          ${escapeStr(strVal('primary_color'))}, ${escapeStr(strVal('secondary_color'))},
          ${escapeStr(strVal('storytelling'))},
          ${escapeStr(strVal('weather'))}, ${escapeStr(strVal('environment'))},
          ${escapeStr(strVal('card_region'))}, ${escapeStr(strVal('card_locations'))},
          ${escapeStr(strVal('pkmn_region'))},
          ${escapeStr(arrayVal('items'))}, ${escapeStr(arrayVal('held_item'))},
          ${escapeStr(arrayVal('pokeball'))},
          ${escapeStr(arrayVal('evolution_items'))}, ${escapeStr(arrayVal('berries'))},
          ${escapeStr(arrayVal('card_subcategory'))},
          ${escapeStr(strVal('trainer_card_type'))}, ${escapeStr(arrayVal('trainer_card_subgroup'))},
          ${escapeStr(strVal('stamp'))},
          ${escapeStr(arrayVal('holiday_theme'))}, ${escapeStr(arrayVal('multi_card'))},
          ${escapeStr(strVal('shape'))},
          ${escapeStr(strVal('video_game'))}, ${escapeStr(strVal('video_game_location'))},
          ${boolVal('video_appearance')}, ${boolVal('shorts_appearance')}, ${boolVal('region_appearance')},
          ${boolVal('thumbnail_used')},
          ${escapeStr(strVal('video_url'))}, ${escapeStr(strVal('video_title'))},
          ${escapeStr(arrayVal('video_type'))}, ${escapeStr(arrayVal('video_region'))}, ${escapeStr(arrayVal('video_location'))},
          ${escapeStr(strVal('top_10_themes'))}, ${escapeStr(strVal('wtpc_episode'))},
          ${boolVal('pocket_exclusive')}, ${boolVal('owned')},
          ${escapeStr(strVal('unique_id'))}, ${escapeStr(strVal('notes'))},
          ${escapeStr(strVal('image_override'))},
          ${escapeJson(annotations)}`;

        if (isPocket) {
          pocketRows.push(`(
            ${escapeStr(card.id)}, ${escapeStr(card.name || '')},
            ${escapeStr(strVal('set_id'))}, ${escapeStr(strVal('rarity'))},
            ${escapeStr(strVal('card_type'))}, ${escapeStr(strVal('element'))},
            ${escapeStr(strVal('hp'))}, ${escapeStr(strVal('stage'))},
            ${escapeStr(strVal('retreat_cost'))}, ${escapeStr(strVal('weakness'))},
            ${escapeStr(strVal('evolves_from'))},
            ${escapeStr(Array.isArray(card.packs) ? JSON.stringify(card.packs) : (card.packs || '[]'))},
            ${escapeStr(strVal('image_url'))}, ${escapeStr(strVal('illustrator'))},
            'Pocket', TRUE,
            ${promotedVals}
          )`);
        } else {
          const subtypesStr = Array.isArray(card.subtypes) ? JSON.stringify(card.subtypes) : (card.subtypes || '[]');
          const typesStr = Array.isArray(card.types) ? JSON.stringify(card.types) : (card.types || '[]');
          const hpStr = card.hp != null ? String(card.hp) : '';
          tcgRows.push(`(
            ${escapeStr(card.id)}, ${escapeStr(card.name || '')}, ${escapeStr(card.supertype || '')},
            ${escapeStr(subtypesStr)}, ${escapeStr(hpStr)}, ${escapeStr(typesStr)},
            ${escapeStr(card.evolves_from || '')}, ${escapeStr(card.rarity || '')},
            ${escapeStr(card.special_rarity || '')}, ${escapeStr(card.alt_name || '')},
            ${escapeStr(card.artist || '')},
            ${escapeStr(card.set_id || '')}, ${escapeStr(card.set_name || '')}, ${escapeStr(card.set_series || '')},
            ${escapeStr(card.number || '')}, ${escapeStr(card.regulation_mark || '')},
            ${escapeStr(card.image_small || card.image_url || '')}, ${escapeStr(card.image_large || card.image_url || '')},
            ${escapeStr(card.source || 'TCG')}, TRUE,
            ${promotedVals}
          )`);
        }
      }

      const BATCH_SIZE = 25;
      for (let i = 0; i < pocketRows.length; i += BATCH_SIZE) {
        const batch = pocketRows.slice(i, i + BATCH_SIZE);
        await conn.query(`
          INSERT INTO pocket_cards (
            id, name, set_id, rarity, card_type, element, hp, stage,
            retreat_cost, weakness, evolves_from,
            packs, image_url, illustrator, source, is_custom,
            ${PROMOTED_COL_NAMES}
          ) VALUES ${batch.join(',')}
        `);
      }
      for (let i = 0; i < tcgRows.length; i += BATCH_SIZE) {
        const batch = tcgRows.slice(i, i + BATCH_SIZE);
        await conn.query(`
          INSERT INTO tcg_cards (
            id, name, supertype, subtypes, hp, types, evolves_from,
            rarity, special_rarity, alt_name, artist,
            set_id, set_name, set_series, number,
            regulation_mark, image_small, image_large, source, is_custom,
            ${PROMOTED_COL_NAMES}
          ) VALUES ${batch.join(',')}
        `);
      }
    if (customCardsFromJson) {
      await Promise.all(customCards.filter(c => c.id).map(c => idbPut(STORE_CUSTOM_CARDS, c)));
      await idbPut(STORE_ATTRIBUTES, { key: "custom_cards_initialized", value: true });
      if (newChecksum) {
        await idbPut(STORE_ATTRIBUTES, { key: "custom_cards_checksum", value: newChecksum });
      }
    }
  }

  // Load annotations from GitHub-committed annotations.json
  try {
    const annResp = await fetch(`${base}data/annotations.json`);
    if (annResp.ok) {
      const annData = await annResp.json();
      for (const [cardId, data] of Object.entries(annData)) {
        const escaped = escapeJson(data);
        const escapedId = escapeStr(cardId);
        const promotedSet = buildPromotedSetClause(data);
        const extraSet = promotedSet ? `, ${promotedSet}` : '';
        await conn.query(`UPDATE tcg_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`);
        await conn.query(`UPDATE pocket_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`);
      }
    }
  } catch (e) {
    console.warn("Could not load annotations.json:", e.message);
  }

  // Populate customSourceNames from distinct source values in custom tcg_cards
  const sourceResult = await conn.query(
    "SELECT DISTINCT source FROM tcg_cards WHERE is_custom = TRUE AND source IS NOT NULL AND source != ''"
  );
  customSourceNames = new Set(sourceResult.toArray().map(r => r.source));

  // 5. Create attribute_definitions table with built-in seeds
  await conn.query(`
    CREATE OR REPLACE TABLE attribute_definitions (
      key           VARCHAR PRIMARY KEY,
      label         VARCHAR,
      value_type    VARCHAR,
      options       JSON,
      default_value JSON,
      is_builtin    BOOLEAN DEFAULT FALSE,
      sort_order    INTEGER DEFAULT 0
    )
  `);

  // Build video game options in JavaScript to avoid SQL escaping issues with apostrophes
  const videoGameOptions = JSON.stringify([
    "Red/Blue", "Gold/Silver", "Ruby/Sapphire", "FireRed/LeafGreen",
    "Diamond/Pearl", "Platinum", "HeartGold/SoulSilver",
    "Black/White", "Black 2/White 2", "X/Y", "Omega Ruby/Alpha Sapphire",
    "Sun/Moon", "Ultra Sun/Ultra Moon", "Let's Go Pikachu/Eevee",
    "Sword/Shield", "Brilliant Diamond/Shining Pearl",
    "Legends Arceus", "Scarlet/Violet", "Other"
  ]);

  // Shape options from PokeAPI
  const shapeOptions = JSON.stringify([
    "ball", "squiggle", "fish", "arms", "blob", "upright", "legs",
    "quadruped", "wings", "tentacles", "heads", "humanoid", "bug-wings", "armor"
  ]);

  await conn.query(`
    INSERT INTO attribute_definitions VALUES
      ('owned',            'Owned',              'boolean', 'null', 'false',   TRUE, 0),
      ('notes',            'Notes',              'text',    'null', '""',      TRUE, 1),
      ('main_character',   'Main Character',     'text',    'null', '""',      TRUE, 2),
      ('background_pokemon', 'Background Pok\u00e9mon', 'text', 'null', '""', TRUE, 3),
      ('background_humans', 'Background Humans', 'text', 'null', '""',    TRUE, 3),
      ('art_style',        'Art Style',          'text',    'null', '""',      TRUE, 4),
      ('color',            'Color',              'select',  '["black","blue","brown","gray","green","pink","purple","red","white","yellow"]', 'null', TRUE, 5),
      ('shape',            'Shape',              'select',  ${escapeStr(shapeOptions)}, 'null', TRUE, 6),
      ('emotion',          'Emotion',            'text',    'null', '""',      TRUE, 7),
      ('pose',             'Pose',               'text',    'null', '""',      TRUE, 8),
      ('camera_angle',     'Camera Angle',       'text',    'null', '""',      TRUE, 9),
      ('location',         'Location',           'text',    'null', '""',      TRUE, 10),
      ('video_game',       'Video Game',         'select',  ${escapeStr(videoGameOptions)}, 'null', TRUE, 11),
      ('video_appearance', 'Video Appearance',   'boolean', 'null', 'false',   TRUE, 12),
      ('thumbnail_used',   'Thumbnail Used',     'boolean', 'null', 'false',   TRUE, 13),
      ('video_url',        'Video URL',          'text',    'null', '""',      TRUE, 14),
      ('video_title',      'Video Title',        'text',    'null', '""',      TRUE, 15),
      ('unique_id',        'Unique ID',          'text',    'null', '""',      TRUE, 16),
      ('items',            'Items',              'text',    'null', '""',      TRUE, 17),
      ('actions',          'Actions',            'text',    'null', '""',      TRUE, 18),
      ('additional_characters', 'Additional Characters', 'text', 'null', '""', TRUE, 19),
      ('evolution_line',   'Evolution Line',     'text',    'null', '""',      TRUE, 20),
      ('perspective',      'Perspective',        'text',    'null', '""',      TRUE, 21),
      ('weather',             'Weather',             'text', 'null', '""',    TRUE, 22),
      ('environment',         'Environment',         'text', 'null', '""',    TRUE, 23),
      ('storytelling',     'Storytelling',        'text',    'null', '""',     TRUE, 23),
      ('background_details', 'Background Details', 'text', 'null', '""',      TRUE, 24),
      ('card_locations',   'Card Locations',     'text',    'null', '""',      TRUE, 25),
      ('pkmn_region',      'Featured Region', 'text',  'null', '""',     TRUE, 26),
      ('card_region',      'Card Region',      'text', 'null', '""', TRUE, 27),
      ('card_subcategory', 'Card Subcategory', 'text', 'null', '""', TRUE, 28),
      ('held_item',        'Held Item',        'text', 'null', '""', TRUE, 29),
      ('pokeball',         'Pokeball',         'text', 'null', '""', TRUE, 30),
      ('evolution_items',  'Evolution Items',  'text', 'null', '""', TRUE, 31),
      ('berries',          'Berries',          'text', 'null', '""', TRUE, 32),
      ('holiday_theme',    'Holiday Theme',    'text', 'null', '""', TRUE, 33),
      ('multi_card',       'Multi Card',       'text', 'null', '""', TRUE, 34),
      ('trainer_card_type','Trainer Card Type','text', 'null', '""', TRUE, 35),
      ('trainer_card_subgroup','Trainer Card Subgroup','text','null','""',TRUE, 36),
      ('video_type',     'Video Type',     'text', 'null', '""', TRUE, 37),
      ('video_region',   'Video Region',   'text', 'null', '""', TRUE, 38),
      ('video_location', 'Video Location', 'text', 'null', '""', TRUE, 39),
      ('card_border',    'Card Border',    'text', 'null', '""', TRUE, 40),
      ('energy_type',    'Energy Type',    'text', 'null', '""', TRUE, 41),
      ('rival_group',    'Rival Group',    'text', 'null', '""', TRUE, 42)
  `);

  // 6. Hydrate from IndexedDB
  await hydrateFromIndexedDB();
  } catch (e) {
    throw new Error("Loading card data: " + (e?.message || e));
  }

  initialized = true;
}

async function hydrateFromIndexedDB() {
  // Hydrate annotations — write both JSON blob AND promoted columns (only one table will match per ID)
  const annotations = await idbGetAll(STORE_ANNOTATIONS);
  for (const row of annotations) {
    const escaped = escapeJson(row.data);
    const escapedId = escapeStr(row.id);
    const promotedSet = buildPromotedSetClause(row.data);
    const extraSet = promotedSet ? `, ${promotedSet}` : '';
    await conn.query(`UPDATE tcg_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`);
    await conn.query(`UPDATE pocket_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`);
  }

  // Hydrate custom attributes
  const attrs = await idbGetAll(STORE_ATTRIBUTES);
  for (const attr of attrs) {
    const existing = await conn.query(
      `SELECT key FROM attribute_definitions WHERE key = ${escapeStr(attr.key)}`
    );
    if (existing.numRows === 0) {
      await conn.query(`
        INSERT INTO attribute_definitions
          (key, label, value_type, options, default_value, is_builtin, sort_order)
        VALUES (
          ${escapeStr(attr.key)},
          ${escapeStr(attr.label)},
          ${escapeStr(attr.value_type)},
          ${escapeJson(attr.options)},
          ${escapeJson(attr.default_value)},
          FALSE,
          ${parseInt(attr.sort_order) || 100}
        )
      `);
    }
  }

  // Hydrate custom sets
  const customSets = await idbGetAll(STORE_CUSTOM_SETS);
  for (const set of customSets) {
    const existing = await conn.query(
      `SELECT id FROM sets WHERE id = ${escapeStr(set.id)}`
    );
    if (existing.numRows === 0) {
      await conn.query(`
        INSERT INTO sets (id, name, series, release_date)
        VALUES (
          ${escapeStr(set.id)},
          ${escapeStr(set.name)},
          ${escapeStr(set.series || "Custom")},
          ${escapeStr(set.release_date || new Date().toISOString().split("T")[0])}
        )
      `);
    }
  }

  // Hydrate custom cards — route to tcg_cards or pocket_cards based on _table field
  const customCards = await idbGetAll(STORE_CUSTOM_CARDS);
  for (const card of customCards) {
    const isPocket = card._table === 'pocket';
    const table = isPocket ? 'pocket_cards' : 'tcg_cards';
    const existing = await conn.query(
      `SELECT id FROM ${table} WHERE id = ${escapeStr(card.id)} AND is_custom = TRUE`
    );
    if (existing.numRows === 0) {
      // Re-use the same insert logic as initDB by building the card object
      // and calling the shared insert helper via addTcgCard/addPocketCard
      if (isPocket) {
        await _insertPocketCard(card);
      } else {
        await _insertTcgCard(card);
      }
      if (card.source) customSourceNames.add(card.source);
    }
  }
}

// ── Helper to convert Arrow result to JS arrays ────────────────────────

function arrowToRows(result) {
  const batches = result.toArray();
  const columns = result.schema.fields.map((f) => f.name);
  const rows = [];
  for (const row of batches) {
    const r = [];
    for (const col of columns) {
      let val = row[col];
      // Convert BigInt to Number for JSON compatibility
      if (typeof val === "bigint") val = Number(val);
      r.push(val);
    }
    rows.push(r);
  }
  return { columns, rows };
}

// ── Exported API functions ─────────────────────────────────────────────

// Allowlist for sort columns
const ALLOWED_SORT = new Set([
  "name", "hp", "set_name", "rarity", "number", "set_id", "supertype", "id", "price",
  "generation", "region", "pokedex",
]);

const POCKET_ALLOWED_SORT = new Set([
  "name", "hp", "set_name", "rarity", "number", "id",
]);

/**
 * Fetch a paginated list of cards with optional search/filter params.
 */
export async function fetchCards(params = {}) {
  const {
    q = "",
    supertype = "",
    rarity = [],
    set_id = [],
    region = [],
    generation = "",
    color = "",
    artist = [],
    evolution_line = [],
    trainer_type = "",
    specialty = [],
    background_pokemon = [],
    element = [],
    card_type = [],
    stage = [],
    weather = [],
    environment = [],
    actions = [],
    pose = [],
    source = "TCG",
    sort_by = "name",
    sort_dir = "asc",
    page = 1,
    page_size = 40,
  } = params;

  const pageInt = parseInt(page) || 1;
  const pageSizeInt = parseInt(page_size) || 40;
  const offset = (pageInt - 1) * pageSizeInt;
  const safeSortDir = sort_dir === "desc" ? "DESC" : "ASC";

  // ── All sources ────────────────────────────────────────────────────
  if (source === "") {
    const pmJoin = `LEFT JOIN pokemon_metadata pm
      ON pm.pokedex_number = TRY_CAST(
           c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER)`;

    // TCG branch (tcg_cards covers both API and custom TCG cards)
    const tcgConditions = [];
    if (q)              tcgConditions.push(`(c.name ILIKE ${escapeStr("%" + q + "%")} OR c.background_pokemon ILIKE ${escapeStr("%" + q + "%")})`);
    if (supertype)      tcgConditions.push(supertypeSQL(supertype));
    { const s = inSQL(rarity, "c.rarity"); if (s) tcgConditions.push(s); }
    { const s = inSQL(set_id, "c.set_id"); if (s) tcgConditions.push(s); }
    { const s = inSQL(artist, "c.artist"); if (s) tcgConditions.push(s); }
    if (trainer_type)   tcgConditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(trainer_type) + '%')}`);
    if (specialty.length) tcgConditions.push(`(${specialty.map(s => `c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(s) + '%')}`).join(" OR ")})`);
    if (background_pokemon.length) tcgConditions.push(`(${background_pokemon.map(p => `c.background_pokemon ILIKE ${escapeStr('%"' + p.toLowerCase() + '"%')}`).join(" OR ")})`);
    { const s = inSQL(region, "c.pkmn_region"); if (s) tcgConditions.push(s); }
    if (generation)     { const g = parseInt(generation); if (g > 0) tcgConditions.push(`pm.generation = ${g}`); }
    if (color)          tcgConditions.push(`pm.color = ${escapeStr(color)}`);
    { const s = inSQL(evolution_line, "pm.evolution_chain"); if (s) tcgConditions.push(s); }
    { const s = inSQL(weather, "c.weather"); if (s) tcgConditions.push(s); }
    { const s = inSQL(environment, "c.environment"); if (s) tcgConditions.push(s); }
    if (actions.length) tcgConditions.push(`(${actions.map(a => `c.actions ILIKE ${escapeStr('%' + a + '%')}`).join(" OR ")})`);
    if (pose.length) tcgConditions.push(`(${pose.map(p => `c.pose ILIKE ${escapeStr('%' + p + '%')}`).join(" OR ")})`);
    const tcgWhere = tcgConditions.length ? "WHERE " + tcgConditions.join(" AND ") : "";

    // Pocket branch: excluded if any filter with no Pocket equivalent is active
    let pocketExcluded = !!(trainer_type || specialty.length || generation || color || rarity.length || weather.length || environment.length || actions.length || pose.length);
    const pocketConditions = [];
    if (q)              pocketConditions.push(`(pc.name ILIKE ${escapeStr("%" + q + "%")} OR pc.background_pokemon ILIKE ${escapeStr("%" + q + "%")})`);
    { const s = inSQL(region, "pc.pkmn_region"); if (s) pocketConditions.push(s); }
    { const s = inSQL(evolution_line, "pc.evolution_line"); if (s) pocketConditions.push(s); }
    { const s = inSQL(artist, "pc.illustrator"); if (s) pocketConditions.push(s); }
    { const s = inSQL(set_id, "pc.set_id");      if (s) pocketConditions.push(s); }
    { const s = inSQL(element, "pc.element");    if (s) pocketConditions.push(s); }
    if (background_pokemon.length) pocketConditions.push(`(${background_pokemon.map(p => `pc.background_pokemon ILIKE ${escapeStr('%"' + p.toLowerCase() + '"%')}`).join(" OR ")})`);

    if (supertype && !pocketExcluded) {
      const norm = supertype.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (norm === 'energy') {
        pocketExcluded = true;
      } else if (norm === 'trainer') {
        pocketConditions.push(`LOWER(pc.card_type) IN ('supporter','item','tool','fossil','trainer')`);
      } else {
        pocketConditions.push(`LOWER(pc.card_type) = ${escapeStr(norm)}`);
      }
    }

    const pocketWhere = pocketConditions.length ? "WHERE " + pocketConditions.join(" AND ") : "";

    const tcgSelect = `
      SELECT c.id, c.name, c.set_name, c.image_small, c.image_large, c.image_override, c.source AS _source,
             c.number, c.hp, c.rarity, c.is_custom
      FROM tcg_cards c ${pmJoin} ${tcgWhere}`;

    const pocketSelect = `
      SELECT pc.id, pc.name, ps.name AS set_name,
             pc.image_url AS image_small, pc.image_url AS image_large, NULL AS image_override, 'Pocket' AS _source,
             CAST(pc.number AS VARCHAR) AS number, CAST(pc.hp AS VARCHAR) AS hp, pc.rarity, FALSE AS is_custom
      FROM pocket_cards pc
      LEFT JOIN pocket_sets ps ON ps.id = pc.set_id
      ${pocketWhere}`;

    const parts = [tcgSelect];
    if (!pocketExcluded) parts.push(pocketSelect);
    const unionSQL = parts.join(" UNION ALL ");

    // Dedupe by id preferring custom card when same id exists as both API and custom (e.g. Pikachu xyp-JP279).
    const dedupedSQL = `
      SELECT id, name, set_name, image_small, image_large, image_override, _source, number, hp, rarity, is_custom
      FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY is_custom DESC) AS rn
        FROM (${unionSQL}) combined
      ) ranked
      WHERE rn = 1`;

    const countResult = await conn.query(
      `SELECT COUNT(*)::INTEGER AS cnt FROM (${dedupedSQL}) counted`
    );
    const total = countResult.toArray()[0].cnt;

    const ALL_ALLOWED_SORT = new Set(["name", "set_name", "id", "number", "hp", "rarity"]);
    const allSortBy = ALL_ALLOWED_SORT.has(sort_by) ? sort_by : "name";
    const allOrderBy =
      allSortBy === "number"
        ? "TRY_CAST(list_element(string_split(CAST(COALESCE(number, '') AS VARCHAR), '/'), 1) AS INTEGER)"
        : allSortBy;
    const dataResult = await conn.query(`
      SELECT id, name, set_name, image_small, image_large, image_override, _source, number, hp, rarity, is_custom
      FROM (${dedupedSQL}) counted
      ORDER BY ${allOrderBy} ${safeSortDir}
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `);

    const cards = dataResult.toArray().map((r) => ({
      id: r.id,
      name: r.name,
      set_name: r.set_name,
      image_small: r.image_small,
      image_large: r.image_large,
      image_override: r.image_override || undefined,
      _source: r._source,
      is_custom: r.is_custom,
      annotations: {},
    }));
    return { cards, total, page: pageInt, page_size: pageSizeInt };
  }

  // ── Pocket source ──────────────────────────────────────────────────
  if (source === "Pocket") {
    const conditions = [];
    if (q) conditions.push(`(pc.name ILIKE ${escapeStr("%" + q + "%")} OR pc.background_pokemon ILIKE ${escapeStr("%" + q + "%")})`);
    { const s = inSQL(rarity, "pc.rarity"); if (s) conditions.push(s); }
    { const s = inSQL(set_id, "pc.set_id"); if (s) conditions.push(s); }
    { const s = inSQL(card_type, "pc.card_type"); if (s) conditions.push(s); }
    { const s = inSQL(element, "pc.element"); if (s) conditions.push(s); }
    { const s = inSQL(stage, "pc.stage"); if (s) conditions.push(s); }
    { const s = inSQL(artist, "pc.illustrator"); if (s) conditions.push(s); }
    if (background_pokemon.length) conditions.push(`(${background_pokemon.map(p => `pc.background_pokemon ILIKE ${escapeStr('%"' + p.toLowerCase() + '"%')}`).join(" OR ")})`);

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const safeSortBy = POCKET_ALLOWED_SORT.has(sort_by) ? sort_by : "name";
    let sortExpr;
    if (safeSortBy === "number") {
      sortExpr = "pc.number";
    } else if (safeSortBy === "set_name") {
      sortExpr = "ps.name";
    } else {
      sortExpr = `pc.${safeSortBy}`;
    }

    const joinClause = "LEFT JOIN pocket_sets ps ON ps.id = pc.set_id";

    const countResult = await conn.query(
      `SELECT COUNT(*)::INTEGER AS cnt FROM pocket_cards pc ${joinClause} ${where}`
    );
    const total = countResult.toArray()[0].cnt;

    const dataResult = await conn.query(`
      SELECT pc.id, pc.name,
             pc.card_type AS supertype,
             pc.hp,
             CASE WHEN pc.element IS NOT NULL AND pc.element != '' THEN '["' || pc.element || '"]' ELSE '[]' END AS types,
             pc.rarity,
             pc.set_id,
             ps.name AS set_name,
             CAST(pc.number AS VARCHAR) AS number,
             ${TCGDEX_IMG_SMALL} AS image_small,
             ${TCGDEX_IMG_LARGE} AS image_large,
             pc.image_url AS image_fallback,
             pc.annotations
      FROM pocket_cards pc
      ${joinClause}
      ${where}
      ORDER BY ${sortExpr} ${safeSortDir}
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `);

    const rows = dataResult.toArray();
    const cards = rows.map((r) => {
      const annotations = safeParseJson(r.annotations, {});
      return {
        id: r.id,
        name: r.name,
        supertype: normalizeSupertypeDisplay(r.supertype || ""),
        subtypes: "[]",
        hp: r.hp,
        types: r.types,
        rarity: r.rarity,
        set_id: r.set_id,
        set_name: r.set_name,
        number: r.number,
        image_small: r.image_small,
        image_large: r.image_large,
        image_fallback: r.image_fallback,
        annotations,
      };
    });

    return { cards, total, page: pageInt, page_size: pageSizeInt };
  }

  // ── Custom Cards (all is_custom = TRUE cards) ──────────────────────
  if (source === "Custom") {
    const conditions = ["c.is_custom = TRUE"];
    if (q)         conditions.push(`(c.name ILIKE ${escapeStr("%" + q + "%")} OR c.background_pokemon ILIKE ${escapeStr("%" + q + "%")})`);
    if (supertype) conditions.push(supertypeSQL(supertype));
    { const s = inSQL(artist, "c.artist"); if (s) conditions.push(s); }
    { const s = inSQL(rarity, "c.rarity"); if (s) conditions.push(s); }
    { const s = inSQL(set_id, "c.set_id"); if (s) conditions.push(s); }
    { const s = inSQL(weather, "c.weather"); if (s) conditions.push(s); }
    { const s = inSQL(environment, "c.environment"); if (s) conditions.push(s); }
    if (actions.length) conditions.push(`(${actions.map(a => `c.actions ILIKE ${escapeStr('%' + a + '%')}`).join(" OR ")})`);
    if (pose.length) conditions.push(`(${pose.map(p => `c.pose ILIKE ${escapeStr('%' + p + '%')}`).join(" OR ")})`);
    if (background_pokemon.length) conditions.push(`(${background_pokemon.map(p => `c.background_pokemon ILIKE ${escapeStr('%"' + p.toLowerCase() + '"%')}`).join(" OR ")})`);
    const where = "WHERE " + conditions.join(" AND ");

    const countResult = await conn.query(
      `SELECT COUNT(*)::INTEGER AS cnt FROM tcg_cards c ${where}`
    );
    const total = countResult.toArray()[0].cnt;

    const CUSTOM_ALLOWED_SORT = new Set(["name", "hp", "set_name", "rarity", "number", "set_id", "supertype", "id"]);
    const safeSortBy = CUSTOM_ALLOWED_SORT.has(sort_by) ? sort_by : "name";
    const sortExpr =
      safeSortBy === "number"
        ? "TRY_CAST(list_element(string_split(CAST(COALESCE(c.number, '') AS VARCHAR), '/'), 1) AS INTEGER)"
        : `c.${safeSortBy}`;

    const dataResult = await conn.query(`
      SELECT c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.rarity,
             c.set_id, c.set_name, c.number, c.image_small, c.image_large, c.image_override,
             c.source, c.is_custom
      FROM tcg_cards c
      ${where}
      ORDER BY ${sortExpr} ${safeSortDir}
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `);

    const cards = dataResult.toArray().map((r) => ({
      id: r.id,
      name: r.name,
      supertype: normalizeSupertypeDisplay(r.supertype || ""),
      subtypes: r.subtypes || "[]",
      hp: r.hp,
      types: r.types || "[]",
      rarity: r.rarity,
      set_id: r.set_id,
      set_name: r.set_name,
      number: r.number,
      image_small: r.image_small,
      image_large: r.image_large,
      image_override: r.image_override || undefined,
      is_custom: r.is_custom,
      annotations: {},
    }));

    return { cards, total, page: pageInt, page_size: pageSizeInt };
  }

  // ── TCG + custom sources (all non-Pocket sources route to tcg_cards) ─
  const conditions = [];
  if (source === "TCG") {
    conditions.push(`(c.source = 'TCG' OR (c.is_custom = TRUE AND c.source != 'Pocket'))`);
  } else {
    conditions.push(`c.source = ${escapeStr(source)}`);
  }
  if (q)            conditions.push(`(c.name ILIKE ${escapeStr("%" + q + "%")} OR c.background_pokemon ILIKE ${escapeStr("%" + q + "%")})`);
  if (supertype)    conditions.push(supertypeSQL(supertype));
  { const s = inSQL(rarity, "c.rarity"); if (s) conditions.push(s); }
  { const s = inSQL(set_id, "c.set_id"); if (s) conditions.push(s); }
  { const s = inSQL(artist, "c.artist"); if (s) conditions.push(s); }
  if (trainer_type) conditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(trainer_type) + '%')}`);
  if (specialty.length) conditions.push(`(${specialty.map(s => `c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(s) + '%')}`).join(" OR ")})`);
  if (background_pokemon.length) conditions.push(`(${background_pokemon.map(p => `c.background_pokemon ILIKE ${escapeStr('%"' + p.toLowerCase() + '"%')}`).join(" OR ")})`);
  { const s = inSQL(region, "c.pkmn_region"); if (s) conditions.push(s); }
  if (generation)   { const genInt = parseInt(generation) || 0; if (genInt > 0) conditions.push(`pm.generation = ${genInt}`); }
  if (color)        conditions.push(`pm.color = ${escapeStr(color)}`);
  { const s = inSQL(evolution_line, "pm.evolution_chain"); if (s) conditions.push(s); }
  { const s = inSQL(weather, "c.weather"); if (s) conditions.push(s); }
  { const s = inSQL(environment, "c.environment"); if (s) conditions.push(s); }
  if (actions.length) conditions.push(`(${actions.map(a => `c.actions ILIKE ${escapeStr('%' + a + '%')}`).join(" OR ")})`);
  if (pose.length) conditions.push(`(${pose.map(p => `c.pose ILIKE ${escapeStr('%' + p + '%')}`).join(" OR ")})`);

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const safeSortBy = ALLOWED_SORT.has(sort_by) ? sort_by : "name";
  let sortExpr;
  if (safeSortBy === "number") {
    sortExpr = "TRY_CAST(list_element(string_split(CAST(COALESCE(c.number, '') AS VARCHAR), '/'), 1) AS INTEGER)";
  } else if (safeSortBy === "pokedex") {
    sortExpr = "TRY_CAST(c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER)";
  } else if (safeSortBy === "price") {
    sortExpr = `COALESCE(
      TRY_CAST(c.prices::JSON->'tcgplayer'->'prices'->'normal'->>'market' AS FLOAT),
      TRY_CAST(c.prices::JSON->'tcgplayer'->'prices'->'holofoil'->>'market' AS FLOAT),
      TRY_CAST(c.prices::JSON->'tcgplayer'->'prices'->'reverseHolofoil'->>'market' AS FLOAT),
      TRY_CAST(c.prices::JSON->'tcgplayer'->'prices'->'1stEditionHolofoil'->>'market' AS FLOAT),
      TRY_CAST(c.prices::JSON->'tcgplayer'->'prices'->'unlimitedHolofoil'->>'market' AS FLOAT),
      0
    )`;
  } else if (safeSortBy === "generation") {
    sortExpr = "pm.generation";
  } else if (safeSortBy === "region") {
    sortExpr = "c.pkmn_region";
  } else {
    sortExpr = `c.${safeSortBy}`;
  }

  const joinClause = `
    LEFT JOIN pokemon_metadata pm
      ON pm.pokedex_number = TRY_CAST(
           c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER
         )
  `;

  const countResult = await conn.query(
    `SELECT COUNT(*)::INTEGER AS cnt FROM tcg_cards c ${joinClause} ${where}`
  );
  const total = countResult.toArray()[0].cnt;

  const dataResult = await conn.query(`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.rarity,
           c.set_id, c.set_name, c.number, c.image_small, c.image_large, c.image_override,
           c.source, c.is_custom,
           pm.region, pm.generation, pm.color
    FROM tcg_cards c
    ${joinClause}
    ${where}
    ORDER BY ${sortExpr} ${safeSortDir}
    LIMIT ${pageSizeInt} OFFSET ${offset}
  `);

  const rows = dataResult.toArray();
  const cards = rows.map((r) => ({
    id: r.id,
    name: r.name,
    supertype: normalizeSupertypeDisplay(r.supertype || ""),
    subtypes: r.subtypes || "[]",
    hp: r.hp,
    types: r.types || "[]",
    rarity: r.rarity,
    set_id: r.set_id,
    set_name: r.set_name,
    number: r.number,
    image_small: r.image_small,
    image_large: r.image_large,
    image_override: r.image_override || undefined,
    is_custom: r.is_custom,
    annotations: {},
    region: r.region,
    generation: typeof r.generation === "bigint" ? Number(r.generation) : r.generation,
    color: r.color,
  }));

  return { cards, total, page: pageInt, page_size: pageSizeInt };
}

/**
 * Fetch full details for a single card.
 */
export async function fetchCard(id, source = "TCG") {
  // ── Pocket source ──────────────────────────────────────────────────
  if (source === "Pocket") {
    const result = await conn.query(`
      SELECT pc.id, pc.name, pc.card_type, pc.hp, pc.element, pc.rarity,
             pc.stage, pc.retreat_cost, pc.weakness, pc.evolves_from,
             pc.packs, pc.raw_data, pc.annotations, pc.illustrator,
             pc.set_id, pc.number,
             ${TCGDEX_IMG_SMALL} AS image_small,
             ${TCGDEX_IMG_LARGE} AS image_large,
             pc.image_url AS image_fallback,
             ps.name AS set_name, ps.series AS set_series
      FROM pocket_cards pc
      LEFT JOIN pocket_sets ps ON ps.id = pc.set_id
      WHERE pc.id = ${escapeStr(id)}
    `);

    const rows = result.toArray();
    if (rows.length === 0) throw new Error("Card not found");

    const r = rows[0];
    const raw_data = safeParseJson(r.raw_data, {});
    let annotations = safeParseJson(r.annotations, {});
    const packsRaw = safeParseJson(r.packs, []);
    const packs = Array.isArray(packsRaw) ? packsRaw : [];

    // Auto-populate unique_id if empty
    let needsPatch = false;
    if (!annotations.unique_id) {
      annotations.unique_id = r.id;
      needsPatch = true;
    }
    if (needsPatch) {
      await patchAnnotations(r.id, { unique_id: annotations.unique_id });
    }

    // Build weaknesses array for CardDetail compatibility
    const weaknesses = r.weakness
      ? [{ type: r.weakness, value: "" }]
      : [];

    // Build types array from element
    const types = r.element ? JSON.stringify([r.element]) : "[]";

    return {
      id: r.id,
      name: r.name,
      supertype: normalizeSupertypeDisplay(r.card_type || ""),
      subtypes: "[]",
      hp: r.hp,
      types,
      evolves_from: r.evolves_from || null,
      rarity: r.rarity,
      artist: r.illustrator || null,
      set_id: r.set_id,
      set_name: r.set_name,
      set_series: r.set_series,
      number: String(r.number),
      regulation_mark: null,
      image_small: r.image_small,
      image_large: r.image_large,
      image_fallback: r.image_fallback,
      raw_data: { ...raw_data, weaknesses },
      annotations,
      prices: null,
      pokedex_numbers: [],
      genus: null,
      // Pocket-specific fields
      stage: r.stage || null,
      packs: Array.isArray(packs) ? packs : [],
      retreat_cost: typeof r.retreat_cost === "bigint" ? Number(r.retreat_cost) : r.retreat_cost,
      element: r.element || null,
    };
  }

  // ── TCG + custom sources (all non-Pocket sources route to tcg_cards) ─
  // Include promoted annotation columns so custom card attributes (pose, actions, etc.) are returned
  const result = await conn.query(`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.evolves_from,
           c.rarity, c.special_rarity, c.alt_name, c.artist,
           c.set_id, c.set_name, c.set_series, c.number,
           c.regulation_mark, c.image_small, c.image_large,
           c.raw_data, c.annotations, c.prices,
           c.source, c.is_custom,
           c.art_style, c.main_character, c.background_pokemon, c.background_humans,
           c.additional_characters, c.background_details, c.card_subcategory,
           c.evolution_items, c.berries, c.holiday_theme, c.multi_card, c.trainer_card_subgroup,
           c.video_type, c.video_region, c.video_location,
           c.emotion, c.pose, c.camera_angle, c.items, c.actions, c.perspective,
           c.weather, c.environment, c.storytelling, c.card_locations, c.pkmn_region, c.card_region,
           c.primary_color, c.secondary_color, COALESCE(c.shape, pm.shape) AS shape,
           c.video_game, c.video_game_location, c.video_url, c.video_title, c.unique_id, c.notes,
           c.evolution_line, c.held_item, c.pokeball, c.trainer_card_type, c.stamp, c.card_border,
           c.energy_type, c.rival_group, c.image_override, c.top_10_themes, c.wtpc_episode,
           c.video_appearance, c.shorts_appearance, c.region_appearance, c.thumbnail_used, c.owned, c.pocket_exclusive,
           pm.evolution_chain, pm.genus, pm.color AS pm_color, pm.encounter_location
    FROM tcg_cards c
    LEFT JOIN pokemon_metadata pm
      ON pm.pokedex_number = TRY_CAST(
           c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER
         )
    WHERE c.id = ${escapeStr(id)}
  `);

  const rows = result.toArray();
  if (rows.length === 0) throw new Error("Card not found");

  const r = rows[0];
  const raw_data = safeParseJson(r.raw_data, {});
  // Build annotations from promoted columns first, then merge JSON blob on top
  const promoted = buildPromotedAnnotations(r);
  let annotations = {
    ...promoted,
    ...safeParseJson(r.annotations, {}),
  };
  const prices = safeParseJson(r.prices, {});

  // Auto-populate unique_id if empty (or wrong for custom cards)
  let needsPatch = false;
  if (r.is_custom ? annotations.unique_id !== r.id : !annotations.unique_id) {
    annotations.unique_id = r.id;
    needsPatch = true;
  }

  // For API cards only: auto-populate from pokemon_metadata
  if (!r.is_custom) {
    if (!annotations.evolution_line && r.evolution_chain) {
      try {
        const chain = typeof r.evolution_chain === "string"
          ? JSON.parse(r.evolution_chain)
          : r.evolution_chain;
        if (Array.isArray(chain) && chain.length > 0) {
          annotations.evolution_line = chain.join(" → ");
          needsPatch = true;
        }
      } catch { /* ignore */ }
    }
    if (!annotations.color && r.pm_color) {
      annotations.color = r.pm_color;
      needsPatch = true;
    }
    if (!annotations.shape && r.shape) {
      annotations.shape = r.shape;
      needsPatch = true;
    }
    if (!annotations.location && r.encounter_location) {
      annotations.location = r.encounter_location;
      needsPatch = true;
    }
  }

  if (needsPatch) {
    const patchData = {};
    if (annotations.unique_id) patchData.unique_id = annotations.unique_id;
    if (annotations.evolution_line) patchData.evolution_line = annotations.evolution_line;
    if (annotations.color) patchData.color = annotations.color;
    if (annotations.shape) patchData.shape = annotations.shape;
    if (annotations.location) patchData.location = annotations.location;
    await patchAnnotations(r.id, patchData);
  }

  const pokedex_numbers = raw_data?.nationalPokedexNumbers || [];

  return {
    id: r.id,
    name: r.name,
    alt_name: r.alt_name || null,
    supertype: normalizeSupertypeDisplay(r.supertype || ""),
    subtypes: r.subtypes || "[]",
    hp: r.hp,
    types: r.types || "[]",
    evolves_from: r.evolves_from || null,
    rarity: r.rarity,
    special_rarity: r.special_rarity || null,
    artist: r.artist,
    set_id: r.set_id,
    set_name: r.set_name,
    set_series: r.set_series,
    number: r.number,
    regulation_mark: r.regulation_mark || null,
    image_small: r.image_small || r.image_large,
    image_large: r.image_large,
    image_fallback: r.is_custom ? (r.image_large || r.image_small || undefined) : undefined,
    raw_data,
    annotations,
    prices,
    pokedex_numbers,
    genus: r.genus || null,
    source: r.source,
    is_custom: r.is_custom,
  };
}

// Normalize supertypes: merge "Pokemon" (no accent), mojibake "PokÃ©mon", and other
// corrupted variants into "Pokémon", and deduplicate.
function normalizeSupertypeDisplay(s) {
  if (!s || typeof s !== "string") return s;
  const norm = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (norm === "pokemon") return "Pokémon";
  // Collapse mojibake/corrupted "Pokémon" (e.g. PokÃ©mon, PokÃÂÃÂ©mon): letters-only "pokmon" or "pokemon"
  const alphaOnly = s.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (alphaOnly === "pokemon" || alphaOnly === "pokmon") return "Pokémon";
  return s;
}

function mergeSupertypes(arr) {
  const seen = new Set();
  return arr.map((s) => normalizeSupertypeDisplay(s)).filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

// Fix common UTF-8/Latin-1 mojibake in strings (e.g. Ã© → é).
function fixMojibake(s) {
  if (!s || typeof s !== "string") return s;
  return s
    .replace(/Ã©/g, "é").replace(/Ã‰/g, "É")
    .replace(/Ã /g, "à").replace(/Ã€/g, "À")
    .replace(/Ã¨/g, "è").replace(/Ã‡/g, "Ç").replace(/Ã§/g, "ç")
    .replace(/Ã¢/g, "â").replace(/Ã®/g, "î").replace(/Ã´/g, "ô").replace(/Ã»/g, "û")
    .replace(/Ã¹/g, "ù").replace(/Ã¯/g, "ï").replace(/Ã«/g, "ë").replace(/Ã¼/g, "ü")
    .replace(/ÃÂ/g, ""); // strip remaining artifacts
}

// Parse a raw evolution_chain value (JSON array or plain string) to its display label.
function evoLabel(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.join(" → ") : raw;
  } catch {
    return raw;
  }
}

// Normalize evolution line options: fix mojibake, dedupe by display label, sort alphabetically.
function mergeEvolutionLines(arr) {
  const seenLabels = new Set();
  const result = [];
  for (const raw of arr) {
    const s = fixMojibake(String(raw).trim());
    if (!s) continue;
    const label = evoLabel(s).toLowerCase();
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    result.push(s);
  }
  return result.sort((a, b) => evoLabel(a).localeCompare(evoLabel(b)));
}

// Build a SQL condition for the supertype column that matches "Pokémon", "Pokemon", and mojibake variants.
function supertypeSQL(supertype) {
  const norm = supertype.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (norm === "pokemon") {
    // Match canonical forms and any corrupted "Pokémon" (e.g. PokÃ©mon) that still starts with Pok and ends with mon
    return `(c.supertype IN ('Pokémon', 'Pokemon') OR (c.supertype LIKE 'Pok%mon' AND LENGTH(c.supertype) < 60))`;
  }
  return `c.supertype = ${escapeStr(supertype)}`;
}

/**
 * Fetch distinct values for all filter dropdowns.
 */
export async function fetchFilterOptions(source = "TCG") {
  // ── All sources ────────────────────────────────────────────────────
  if (source === "") {
    const [stResult, raritiesResult, setsResult, regionsResult, generationsResult, colorsResult, artistsResult, evolutionLinesResult, trainerTypesResult, specialtiesResult, weathersResult, environmentsResult, actionsResult, posesResult, bgPokemonResult] =
      await Promise.all([
        conn.query(
          "SELECT DISTINCT supertype FROM tcg_cards WHERE supertype != '' ORDER BY supertype"
        ),
        conn.query(
          "SELECT DISTINCT rarity FROM tcg_cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY rarity"
        ),
        conn.query(
          `SELECT id, name, series FROM sets
           UNION
           SELECT DISTINCT set_id AS id, set_name AS name, set_series AS series
             FROM tcg_cards WHERE is_custom = TRUE AND set_id IS NOT NULL AND set_id != ''
           ORDER BY series, id`
        ),
        conn.query(`
          SELECT DISTINCT val FROM (
            SELECT pkmn_region AS val FROM tcg_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
            UNION
            SELECT pkmn_region AS val FROM pocket_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
          ) WHERE val IS NOT NULL ORDER BY val
        `),
        conn.query(
          "SELECT DISTINCT generation FROM pokemon_metadata WHERE generation IS NOT NULL ORDER BY generation"
        ),
        conn.query(
          "SELECT DISTINCT color FROM pokemon_metadata WHERE color IS NOT NULL ORDER BY color"
        ),
        conn.query(
          `SELECT DISTINCT artist FROM (
            SELECT artist FROM tcg_cards WHERE artist IS NOT NULL AND artist != ''
            UNION
            SELECT illustrator AS artist FROM pocket_cards WHERE illustrator IS NOT NULL AND illustrator != ''
          ) ORDER BY artist`
        ),
        conn.query(
          "SELECT DISTINCT evolution_chain FROM pokemon_metadata WHERE evolution_chain IS NOT NULL ORDER BY evolution_chain"
        ),
        conn.query(`
          SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
            REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
          )))) AS trainer_type
          FROM tcg_cards
          WHERE supertype = 'Trainer' AND subtypes != '[]' AND subtypes != ''
          ORDER BY trainer_type
        `),
        conn.query(`
          SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
            REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
          )))) AS specialty
          FROM tcg_cards
          WHERE subtypes ILIKE '%Ace Spec%'
             OR subtypes ILIKE '%Tool%'
             OR subtypes ILIKE '%Technical%'
          ORDER BY specialty
        `),
        conn.query(
          "SELECT DISTINCT weather FROM tcg_cards WHERE weather IS NOT NULL AND weather != '' ORDER BY weather"
        ),
        conn.query(
          "SELECT DISTINCT environment FROM tcg_cards WHERE environment IS NOT NULL AND environment != '' ORDER BY environment"
        ),
        conn.query(
          "SELECT DISTINCT TRIM(unnest(string_split(actions, ','))) AS val FROM tcg_cards WHERE actions IS NOT NULL AND actions != '' ORDER BY val"
        ),
        conn.query(
          "SELECT DISTINCT TRIM(unnest(string_split(pose, ','))) AS val FROM tcg_cards WHERE pose IS NOT NULL AND pose != '' ORDER BY val"
        ),
        conn.query(`
          SELECT DISTINCT TRIM(val) AS val FROM (
            SELECT unnest(string_split(REPLACE(REPLACE(background_pokemon, '["', ''), '"]', ''), '","')) AS val
            FROM tcg_cards WHERE background_pokemon IS NOT NULL AND background_pokemon != '' AND background_pokemon != '[]'
            UNION
            SELECT unnest(string_split(REPLACE(REPLACE(background_pokemon, '["', ''), '"]', ''), '","')) AS val
            FROM pocket_cards WHERE background_pokemon IS NOT NULL AND background_pokemon != '' AND background_pokemon != '[]'
          ) WHERE TRIM(val) != '' ORDER BY val
        `),
      ]);

    const supertypes = mergeSupertypes(stResult.toArray().map((r) => r.supertype));
    const rarities = raritiesResult.toArray().map((r) => r.rarity);
    const sets = setsResult.toArray().map((r) => ({ id: r.id, name: r.name, series: r.series }));
    const dbRegions = regionsResult.toArray().map((r) => r.val).filter(Boolean);
    const regions = [...new Set([...PKMN_REGION_OPTIONS, ...dbRegions])].sort();
    const generations = generationsResult.toArray().map((r) =>
      typeof r.generation === "bigint" ? Number(r.generation) : r.generation
    );
    const colors = colorsResult.toArray().map((r) => r.color);
    const artists = artistsResult.toArray().map((r) => r.artist);
    const evolution_lines = mergeEvolutionLines(evolutionLinesResult.toArray().map((r) => r.evolution_chain));
    const decodeUnicode = (str) => {
      try { return JSON.parse(`"${str}"`); } catch { return str; }
    };
    const trainer_types = trainerTypesResult.toArray().map((r) => decodeUnicode(r.trainer_type)).filter(t => t);
    const specialties = specialtiesResult.toArray().map((r) => decodeUnicode(r.specialty)).filter(s => s);
    const dbWeathers = weathersResult.toArray().map((r) => r.weather).filter(Boolean);
    const weathers = [...new Set([...WEATHER_OPTIONS, ...dbWeathers])];
    const dbEnvironments = environmentsResult.toArray().map((r) => r.environment).filter(Boolean);
    const environments = [...new Set([...ENVIRONMENT_OPTIONS, ...dbEnvironments])];
    const dbActions = actionsResult.toArray().map((r) => r.val).filter(Boolean);
    const actions = [...new Set([...ACTIONS_OPTIONS, ...dbActions])];
    const dbPoses = posesResult.toArray().map((r) => r.val).filter(Boolean);
    const poses = [...new Set([...POSE_OPTIONS, ...dbPoses])];
    const background_pokemon = bgPokemonResult.toArray().map((r) => r.val).filter(Boolean);

    return {
      supertypes, rarities, sets, regions, generations, colors, artists, evolution_lines, trainer_types, specialties,
      background_pokemon,
      card_types: [], elements: [], stages: [], weathers, environments, actions, poses,
    };
  }

  // ── Pocket source ──────────────────────────────────────────────────
  if (source === "Pocket") {
    const [cardTypesResult, raritiesResult, setsResult, elementsResult, stagesResult, bgPokemonResult] =
      await Promise.all([
        conn.query(
          "SELECT DISTINCT card_type FROM pocket_cards WHERE card_type IS NOT NULL AND card_type != '' ORDER BY card_type"
        ),
        conn.query(
          "SELECT DISTINCT rarity FROM pocket_cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY rarity"
        ),
        conn.query(
          `SELECT id, name, series FROM pocket_sets
           UNION
           SELECT DISTINCT pc.set_id AS id,
             COALESCE(ps.name, pc.set_id) AS name,
             COALESCE(ps.series, '') AS series
           FROM pocket_cards pc
           LEFT JOIN pocket_sets ps ON ps.id = pc.set_id
           WHERE pc.is_custom = TRUE AND pc.set_id IS NOT NULL AND pc.set_id != ''
           ORDER BY series, id`
        ),
        conn.query(
          "SELECT DISTINCT element FROM pocket_cards WHERE element IS NOT NULL AND element != '' ORDER BY element"
        ),
        conn.query(
          "SELECT DISTINCT stage FROM pocket_cards WHERE stage IS NOT NULL AND stage != '' ORDER BY stage"
        ),
        conn.query(`
          SELECT DISTINCT TRIM(val) AS val FROM (
            SELECT unnest(string_split(REPLACE(REPLACE(background_pokemon, '["', ''), '"]', ''), '","')) AS val
            FROM pocket_cards WHERE background_pokemon IS NOT NULL AND background_pokemon != '' AND background_pokemon != '[]'
          ) WHERE TRIM(val) != '' ORDER BY val
        `),
      ]);

    return {
      supertypes: [],
      rarities: raritiesResult.toArray().map((r) => r.rarity),
      sets: setsResult.toArray().map((r) => ({ id: r.id, name: r.name, series: r.series })),
      regions: [],
      generations: [],
      colors: [],
      artists: [],
      evolution_lines: [],
      trainer_types: [],
      specialties: [],
      background_pokemon: bgPokemonResult.toArray().map((r) => r.val).filter(Boolean),
      // Pocket-specific
      card_types: cardTypesResult.toArray().map((r) => r.card_type),
      elements: elementsResult.toArray().map((r) => r.element),
      stages: stagesResult.toArray().map((r) => r.stage),
      weathers: [],
      environments: [],
      actions: [],
      poses: [],
    };
  }

  // ── Custom Cards (is_custom = TRUE) ────────────────────────────────
  if (source === "Custom") {
    const [stResult, raritiesResult, setsResult, artistsResult, bgPokemonResult] = await Promise.all([
      conn.query(
        `SELECT DISTINCT supertype FROM tcg_cards WHERE is_custom = TRUE AND supertype IS NOT NULL AND supertype != '' ORDER BY supertype`
      ),
      conn.query(
        `SELECT DISTINCT rarity FROM tcg_cards WHERE is_custom = TRUE AND rarity IS NOT NULL AND rarity != '' ORDER BY rarity`
      ),
      conn.query(
        `SELECT DISTINCT set_id AS id, set_name AS name, set_series AS series FROM tcg_cards WHERE is_custom = TRUE AND set_id IS NOT NULL AND set_id != '' ORDER BY set_series, set_name`
      ),
      conn.query(
        `SELECT DISTINCT artist FROM tcg_cards WHERE is_custom = TRUE AND artist IS NOT NULL AND artist != '' ORDER BY artist`
      ),
      conn.query(`
        SELECT DISTINCT TRIM(val) AS val FROM (
          SELECT unnest(string_split(REPLACE(REPLACE(background_pokemon, '["', ''), '"]', ''), '","')) AS val
          FROM tcg_cards WHERE is_custom = TRUE AND background_pokemon IS NOT NULL AND background_pokemon != '' AND background_pokemon != '[]'
        ) WHERE TRIM(val) != '' ORDER BY val
      `),
    ]);

    return {
      supertypes: mergeSupertypes(stResult.toArray().map((r) => r.supertype)),
      rarities: raritiesResult.toArray().map((r) => r.rarity),
      sets: setsResult.toArray().map((r) => ({ id: r.id, name: r.name, series: r.series })),
      regions: [],
      generations: [],
      colors: [],
      artists: artistsResult.toArray().map((r) => r.artist),
      evolution_lines: [],
      trainer_types: [],
      specialties: [],
      background_pokemon: bgPokemonResult.toArray().map((r) => r.val).filter(Boolean),
      card_types: [],
      elements: [],
      stages: [],
      weathers: [],
      environments: [],
      actions: [],
      poses: [],
    };
  }

  // ── Custom source (non-Pocket, non-TCG) — route to tcg_cards ──────────
  // (Also handles the default TCG source since all routes to tcg_cards)
  const srcFilter = source === "TCG"
    ? `(source = 'TCG' OR (is_custom = TRUE AND source != 'Pocket'))`
    : `source = ${escapeStr(source)}`;

  const [stResult, raritiesResult, setsResult, regionsResult, generationsResult, colorsResult, artistsResult, evolutionLinesResult, trainerTypesResult, specialtiesResult, weathersResult, environmentsResult, actionsResult, posesResult, bgPokemonResult] =
    await Promise.all([
      conn.query(
        `SELECT DISTINCT supertype FROM tcg_cards WHERE ${srcFilter} AND supertype != '' ORDER BY supertype`
      ),
      conn.query(
        `SELECT DISTINCT rarity FROM tcg_cards WHERE ${srcFilter} AND rarity IS NOT NULL AND rarity != '' ORDER BY rarity`
      ),
      conn.query(
        `SELECT DISTINCT set_id AS id, set_name AS name, set_series AS series FROM tcg_cards WHERE ${srcFilter} AND set_id IS NOT NULL AND set_id != '' ORDER BY set_series, set_name`
      ),
      conn.query(`
        SELECT DISTINCT val FROM (
          SELECT pkmn_region AS val FROM tcg_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
          UNION
          SELECT pkmn_region AS val FROM pocket_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
        ) WHERE val IS NOT NULL ORDER BY val
      `),
      conn.query(
        "SELECT DISTINCT generation FROM pokemon_metadata WHERE generation IS NOT NULL ORDER BY generation"
      ),
      conn.query(
        "SELECT DISTINCT color FROM pokemon_metadata WHERE color IS NOT NULL ORDER BY color"
      ),
      conn.query(
        `SELECT DISTINCT artist FROM tcg_cards WHERE ${srcFilter} AND artist IS NOT NULL AND artist != '' ORDER BY artist`
      ),
      conn.query(
        "SELECT DISTINCT evolution_chain FROM pokemon_metadata WHERE evolution_chain IS NOT NULL ORDER BY evolution_chain"
      ),
      conn.query(`
        SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
          REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
        )))) AS trainer_type
        FROM tcg_cards
        WHERE ${srcFilter} AND supertype = 'Trainer' AND subtypes != '[]' AND subtypes != ''
        ORDER BY trainer_type
      `),
      conn.query(`
        SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
          REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
        )))) AS specialty
        FROM tcg_cards
        WHERE ${srcFilter} AND (subtypes ILIKE '%Ace Spec%' OR subtypes ILIKE '%Tool%' OR subtypes ILIKE '%Technical%')
        ORDER BY specialty
      `),
      conn.query(
        `SELECT DISTINCT weather FROM tcg_cards WHERE ${srcFilter} AND weather IS NOT NULL AND weather != '' ORDER BY weather`
      ),
      conn.query(
        `SELECT DISTINCT environment FROM tcg_cards WHERE ${srcFilter} AND environment IS NOT NULL AND environment != '' ORDER BY environment`
      ),
      conn.query(
        `SELECT DISTINCT TRIM(unnest(string_split(actions, ','))) AS val FROM tcg_cards WHERE ${srcFilter} AND actions IS NOT NULL AND actions != '' ORDER BY val`
      ),
      conn.query(
        `SELECT DISTINCT TRIM(unnest(string_split(pose, ','))) AS val FROM tcg_cards WHERE ${srcFilter} AND pose IS NOT NULL AND pose != '' ORDER BY val`
      ),
      conn.query(`
        SELECT DISTINCT TRIM(val) AS val FROM (
          SELECT unnest(string_split(REPLACE(REPLACE(background_pokemon, '["', ''), '"]', ''), '","')) AS val
          FROM tcg_cards WHERE ${srcFilter} AND background_pokemon IS NOT NULL AND background_pokemon != '' AND background_pokemon != '[]'
        ) WHERE TRIM(val) != '' ORDER BY val
      `),
    ]);

  const supertypes = mergeSupertypes(stResult.toArray().map((r) => r.supertype));
  const rarities = raritiesResult.toArray().map((r) => r.rarity);
  const sets = setsResult.toArray().map((r) => ({
    id: r.id,
    name: r.name,
    series: r.series,
  }));
  const dbRegions = regionsResult.toArray().map((r) => r.val).filter(Boolean);
  const regions = [...new Set([...PKMN_REGION_OPTIONS, ...dbRegions])].sort();
  const generations = generationsResult.toArray().map((r) =>
    typeof r.generation === "bigint" ? Number(r.generation) : r.generation
  );
  const colors = colorsResult.toArray().map((r) => r.color);
  const artists = artistsResult.toArray().map((r) => r.artist);
  const evolution_lines = mergeEvolutionLines(evolutionLinesResult.toArray().map((r) => r.evolution_chain));
  // Decode Unicode escape sequences (e.g., \u00e9 -> é)
  const decodeUnicode = (str) => {
    try {
      return JSON.parse(`"${str}"`);
    } catch {
      return str;
    }
  };
  const trainer_types = trainerTypesResult.toArray().map((r) => decodeUnicode(r.trainer_type)).filter(t => t);
  const specialties = specialtiesResult.toArray().map((r) => decodeUnicode(r.specialty)).filter(s => s);
  const dbWeathers = weathersResult.toArray().map((r) => r.weather).filter(Boolean);
  const weathers = [...new Set([...WEATHER_OPTIONS, ...dbWeathers])];
  const dbEnvironments = environmentsResult.toArray().map((r) => r.environment).filter(Boolean);
  const environments = [...new Set([...ENVIRONMENT_OPTIONS, ...dbEnvironments])];
  const dbActions = actionsResult.toArray().map((r) => r.val).filter(Boolean);
  const actions = [...new Set([...ACTIONS_OPTIONS, ...dbActions])];
  const dbPoses = posesResult.toArray().map((r) => r.val).filter(Boolean);
  const poses = [...new Set([...POSE_OPTIONS, ...dbPoses])];
  const background_pokemon = bgPokemonResult.toArray().map((r) => r.val).filter(Boolean);

  return {
    supertypes, rarities, sets, regions, generations, colors, artists, evolution_lines, trainer_types, specialties,
    background_pokemon,
    // Empty Pocket-only fields
    card_types: [], elements: [], stages: [], weathers, environments, actions, poses,
  };
}

// ── Form Options (for custom card form comboboxes) ─────────────────────

/**
 * Fetch distinct values for custom card form comboboxes.
 * Queries tcg_cards, pokemon_metadata, and sets tables.
 */
export async function fetchFormOptions() {
  const queries = await Promise.all([
    // rarity: from tcg_cards
    conn.query(
      `SELECT DISTINCT rarity AS val FROM tcg_cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY val`
    ),
    // artist: from tcg_cards
    conn.query(
      `SELECT DISTINCT artist AS val FROM tcg_cards WHERE artist IS NOT NULL AND artist != '' ORDER BY val`
    ),
    // pkmnRegion: from pokemon_metadata
    conn.query(
      `SELECT DISTINCT region AS val FROM pokemon_metadata WHERE region IS NOT NULL AND region != '' ORDER BY val`
    ),
    // setSeries: from sets
    conn.query(
      `SELECT DISTINCT series AS val FROM sets WHERE series IS NOT NULL AND series != '' ORDER BY val`
    ),
    // types: from cards (unnest JSON array)
    conn.query(
      `SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
        REPLACE(REPLACE(types, '[', ''), ']', ''), ','
      )))) AS val FROM tcg_cards WHERE types != '[]' AND types != '' ORDER BY val`
    ),
    // subtypes: from cards (unnest JSON array)
    conn.query(
      `SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
        REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
      )))) AS val FROM tcg_cards WHERE subtypes != '[]' AND subtypes != '' ORDER BY val`
    ),
    // emotion: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(emotion, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE emotion IS NOT NULL AND emotion != '' AND emotion != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // pose: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(pose, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE pose IS NOT NULL AND pose != '' AND pose != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // cameraAngle: from tcg_cards
    conn.query(
      `SELECT DISTINCT camera_angle AS val FROM tcg_cards WHERE camera_angle IS NOT NULL AND camera_angle != '' ORDER BY val`
    ),
    // perspective: from tcg_cards
    conn.query(
      `SELECT DISTINCT perspective AS val FROM tcg_cards WHERE perspective IS NOT NULL AND perspective != '' ORDER BY val`
    ),
    // weather: from tcg_cards
    conn.query(
      `SELECT DISTINCT weather AS val FROM tcg_cards WHERE weather IS NOT NULL AND weather != '' ORDER BY val`
    ),
    // environment: from tcg_cards
    conn.query(
      `SELECT DISTINCT environment AS val FROM tcg_cards WHERE environment IS NOT NULL AND environment != '' ORDER BY val`
    ),
    // storytelling: from tcg_cards
    conn.query(
      `SELECT DISTINCT storytelling AS val FROM tcg_cards WHERE storytelling IS NOT NULL AND storytelling != '' ORDER BY val`
    ),
    // cardLocations: from tcg_cards
    conn.query(
      `SELECT DISTINCT card_locations AS val FROM tcg_cards WHERE card_locations IS NOT NULL AND card_locations != '' ORDER BY val`
    ),
    // items: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(items, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE items IS NOT NULL AND items != '' AND items != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // actions: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(actions, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE actions IS NOT NULL AND actions != '' AND actions != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // videoTitle: from tcg_cards
    conn.query(
      `SELECT DISTINCT video_title AS val FROM tcg_cards WHERE video_title IS NOT NULL AND video_title != '' ORDER BY val`
    ),
    // setId: from sets + tcg_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT id AS val FROM sets WHERE id IS NOT NULL AND id != ''
        UNION SELECT set_id AS val FROM tcg_cards WHERE set_id IS NOT NULL AND set_id != ''
      ) ORDER BY val`
    ),
    // setName: from sets + tcg_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT name AS val FROM sets WHERE name IS NOT NULL AND name != ''
        UNION SELECT set_name AS val FROM tcg_cards WHERE set_name IS NOT NULL AND set_name != ''
      ) ORDER BY val`
    ),
    // name: from tcg_cards
    conn.query(
      `SELECT DISTINCT name AS val FROM tcg_cards WHERE name IS NOT NULL AND name != '' ORDER BY val`
    ),
    // source: from tcg_cards (custom only)
    conn.query(
      `SELECT DISTINCT source AS val FROM tcg_cards WHERE is_custom = TRUE AND source IS NOT NULL AND source != '' ORDER BY val`
    ),
    // heldItem: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(held_item, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE held_item IS NOT NULL AND held_item != '' AND held_item != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // pokeball: from tcg_cards (JSON array column — split to individual options)
    conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(pokeball, '["', ''), '"]', ''),
          '","'
        )) AS val FROM tcg_cards
        WHERE pokeball IS NOT NULL AND pokeball != '' AND pokeball != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    ),
    // trainerCardType: from tcg_cards
    conn.query(
      `SELECT DISTINCT trainer_card_type AS val FROM tcg_cards WHERE trainer_card_type IS NOT NULL AND trainer_card_type != '' ORDER BY val`
    ),
    // stamp: from tcg_cards
    conn.query(
      `SELECT DISTINCT stamp AS val FROM tcg_cards WHERE stamp IS NOT NULL AND stamp != '' ORDER BY val`
    ),
    // cardBorder: from tcg_cards
    conn.query(
      `SELECT DISTINCT card_border AS val FROM tcg_cards WHERE card_border IS NOT NULL AND card_border != '' ORDER BY val`
    ),
    // energyType: from tcg_cards
    conn.query(
      `SELECT DISTINCT energy_type AS val FROM tcg_cards WHERE energy_type IS NOT NULL AND energy_type != '' ORDER BY val`
    ),
    // rivalGroup: from tcg_cards
    conn.query(
      `SELECT DISTINCT rival_group AS val FROM tcg_cards WHERE rival_group IS NOT NULL AND rival_group != '' ORDER BY val`
    ),
  ]);

  // Filter out any value that looks like a raw JSON array (starts with '[') —
  // these are corrupted/double-encoded values that should never appear as options.
  const isCleanOption = (v) => v && !String(v).startsWith('[');

  const toArr = (result) => result.toArray().map((r) => r.val).filter(isCleanOption);

  // For multi-value fields stored as JSON arrays or comma-separated, we need to split them
  const splitJsonArrayValues = async (column, table = "tcg_cards") => {
    const result = await conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(${column}, '["', ''), '"]', ''),
          '","'
        )) AS val FROM ${table}
        WHERE ${column} IS NOT NULL AND ${column} != '' AND ${column} != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    );
    return result.toArray().map((r) => r.val).filter(isCleanOption);
  };

  const [artStyle, mainCharacter, backgroundPokemon, backgroundHumans,
         additionalCharacters, backgroundDetails, evolutionLine,
         cardSubcategory, evolutionItems, berries, holidayTheme, multiCard,
         trainerCardSubgroup, videoType, videoRegion, videoLocation] = await Promise.all([
    splitJsonArrayValues("art_style"),
    splitJsonArrayValues("main_character"),
    // background_pokemon: from custom cards + all pokemon names from metadata
    (async () => {
      const [customResult, pmResult] = await Promise.all([
        splitJsonArrayValues("background_pokemon"),
        conn.query(`SELECT DISTINCT name AS val FROM pokemon_metadata WHERE name IS NOT NULL ORDER BY name`),
      ]);
      const fromCustom = customResult.map((v) => v.toLowerCase());
      const fromPm = pmResult.toArray().map((r) => r.val).filter(Boolean);
      return [...new Set([...fromPm, ...fromCustom])].sort();
    })(),
    // background_humans: from custom cards only
    splitJsonArrayValues("background_humans"),
    splitJsonArrayValues("additional_characters"),
    splitJsonArrayValues("background_details"),
    // evolution_line: full chains from tcg_cards + pokemon_metadata.evolution_chain (mojibake fixed, deduped)
    (async () => {
      const [customResult, pmResult] = await Promise.all([
        conn.query(
          `SELECT DISTINCT TRIM(evolution_line) AS val
           FROM tcg_cards WHERE evolution_line IS NOT NULL AND evolution_line != ''
           ORDER BY val`
        ),
        conn.query(
          `SELECT DISTINCT evolution_chain AS val
           FROM pokemon_metadata WHERE evolution_chain IS NOT NULL AND evolution_chain != '' AND evolution_chain != '[]'
           ORDER BY val`
        ),
      ]);
      const fromCustom = customResult.toArray().map((r) => r.val?.toLowerCase()).filter(Boolean);
      const fromPm = pmResult.toArray().map((r) => {
        if (!r.val) return null;
        try {
          const parsed = JSON.parse(r.val);
          return Array.isArray(parsed) ? parsed.join(" → ") : String(r.val);
        } catch {
          return String(r.val);
        }
      }).filter(Boolean);
      return mergeEvolutionLines([...fromPm, ...fromCustom]);
    })(),
    splitJsonArrayValues("card_subcategory"),
    splitJsonArrayValues("evolution_items"),
    splitJsonArrayValues("berries"),
    splitJsonArrayValues("holiday_theme"),
    splitJsonArrayValues("multi_card"),
    splitJsonArrayValues("trainer_card_subgroup"),
    splitJsonArrayValues("video_type"),
    splitJsonArrayValues("video_region"),
    splitJsonArrayValues("video_location"),
  ]);

  // Merge helper: canonical first, then any DB values not already in the list
  const merge = (staticOpts, dbVals) => [...new Set([...staticOpts, ...dbVals])];

  return {
    rarity: toArr(queries[0]),
    artist: toArr(queries[1]),
    pkmnRegion: merge(PKMN_REGION_OPTIONS, toArr(queries[2])),
    cardRegion: merge(PKMN_REGION_OPTIONS, toArr(queries[2])),
    setSeries: toArr(queries[3]),
    types: toArr(queries[4]),
    subtypes: toArr(queries[5]),
    emotion: merge(EMOTION_OPTIONS, toArr(queries[6])),
    pose: merge(POSE_OPTIONS, toArr(queries[7])),
    cameraAngle: merge(CAMERA_ANGLE_OPTIONS, toArr(queries[8])),
    perspective: merge(PERSPECTIVE_OPTIONS, toArr(queries[9])),
    weather: merge(WEATHER_OPTIONS, toArr(queries[10])),
    environment: merge(ENVIRONMENT_OPTIONS, toArr(queries[11])),
    storytelling: toArr(queries[12]),
    cardLocations: merge(CARD_LOCATIONS_OPTIONS, toArr(queries[13])),
    items: merge(ITEMS_OPTIONS, toArr(queries[14])),
    actions: merge(ACTIONS_OPTIONS, toArr(queries[15])),
    videoTitle: toArr(queries[16]),
    setId: toArr(queries[17]),
    setName: toArr(queries[18]),
    name: toArr(queries[19]),
    source: toArr(queries[20]),
    heldItem: merge(HELD_ITEM_OPTIONS, toArr(queries[21])),
    pokeball: merge(POKEBALL_OPTIONS, toArr(queries[22])),
    trainerCardType: merge(TRAINER_CARD_TYPE_OPTIONS, toArr(queries[23])),
    stamp: merge(STAMP_OPTIONS, toArr(queries[24])),
    artStyle: merge(ART_STYLE_OPTIONS, artStyle),
    mainCharacter,
    backgroundPokemon,
    backgroundHumans,
    additionalCharacters: merge(ADDITIONAL_CHARACTERS_OPTIONS, additionalCharacters),
    backgroundDetails: merge(BACKGROUND_DETAILS_OPTIONS, backgroundDetails),
    evolutionLine,
    cardSubcategory: merge(CARD_SUBCATEGORY_OPTIONS, cardSubcategory),
    evolutionItems: merge(EVOLUTION_ITEMS_OPTIONS, evolutionItems),
    berries: merge(BERRIES_OPTIONS, berries),
    holidayTheme: merge(HOLIDAY_THEME_OPTIONS, holidayTheme),
    multiCard: merge(MULTI_CARD_OPTIONS, multiCard),
    trainerCardSubgroup: merge(TRAINER_CARD_SUBGROUP_OPTIONS, trainerCardSubgroup),
    videoType:     merge(VIDEO_TYPE_OPTIONS, videoType),
    videoRegion:   merge(VIDEO_REGION_OPTIONS, videoRegion),
    videoLocation: merge(VIDEO_LOCATION_OPTIONS, videoLocation),
    cardBorder:    merge(CARD_BORDER_OPTIONS, toArr(queries[25])),
    energyType:    merge(ENERGY_TYPE_OPTIONS, toArr(queries[26])),
    rivalGroup:    merge(RIVAL_GROUP_OPTIONS, toArr(queries[27])),
  };
}

// ── Annotations ────────────────────────────────────────────────────────

/**
 * Get annotations for a card.
 */
export async function fetchAnnotations(cardId) {
  let result = await conn.query(
    `SELECT annotations FROM tcg_cards WHERE id = ${escapeStr(cardId)}`
  );
  let rows = result.toArray();
  if (rows.length === 0) {
    result = await conn.query(
      `SELECT annotations FROM pocket_cards WHERE id = ${escapeStr(cardId)}`
    );
    rows = result.toArray();
  }
  if (rows.length === 0) throw new Error("Card not found");

  const val = rows[0].annotations;
  return safeParseJson(val, {});
}

/**
 * Merge annotation updates into a card's existing annotations.
 * Uses JSON merge patch semantics. Write-through to IndexedDB.
 */
export async function patchAnnotations(cardId, annotations) {
  // Read current
  const current = await fetchAnnotations(cardId);

  // Merge patch
  for (const [key, value] of Object.entries(annotations)) {
    if (value === null || value === undefined) {
      delete current[key];
    } else {
      current[key] = value;
    }
  }

  // Write to DuckDB — dual-write: JSON blob + promoted columns on both tables (only one will match)
  const escaped = escapeJson(current);
  const escapedId = escapeStr(cardId);
  const promotedSet = buildPromotedSetClause(annotations);
  const extraSet = promotedSet ? ', ' + promotedSet : '';
  await conn.query(
    `UPDATE tcg_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`
  );
  await conn.query(
    `UPDATE pocket_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`
  );

  // Write-through to IndexedDB
  await idbPut(STORE_ANNOTATIONS, { id: cardId, data: current });

  return current;
}

// ── Attribute Definitions ──────────────────────────────────────────────

function parseAttrRow(r) {
  return {
    key: r.key,
    label: r.label,
    value_type: r.value_type,
    options: safeParseJson(r.options, null),
    default_value: safeParseJson(r.default_value, null),
    is_builtin: r.is_builtin,
    sort_order: typeof r.sort_order === "bigint" ? Number(r.sort_order) : r.sort_order,
  };
}

/**
 * Fetch all attribute definitions.
 */
export async function fetchAttributes() {
  const result = await conn.query(
    "SELECT key, label, value_type, options, default_value, is_builtin, sort_order FROM attribute_definitions ORDER BY sort_order, key"
  );
  return result.toArray().map(parseAttrRow);
}

/**
 * Create a new custom attribute definition.
 */
export async function createAttribute(attr) {
  const { key, label, value_type, options = null, default_value = null } = attr;

  // Key validation
  if (!/^[a-z0-9_]+$/.test(key)) {
    throw new Error("Key must be lowercase letters, numbers, and underscores only");
  }

  // Check for duplicate
  const existing = await conn.query(
    `SELECT key FROM attribute_definitions WHERE key = ${escapeStr(key)}`
  );
  if (existing.numRows > 0) {
    throw new Error(`Attribute '${key}' already exists`);
  }

  // Find max sort_order
  const maxResult = await conn.query(
    "SELECT COALESCE(MAX(sort_order), 0)::INTEGER AS mx FROM attribute_definitions"
  );
  const maxOrder = maxResult.toArray()[0].mx;

  await conn.query(`
    INSERT INTO attribute_definitions
      (key, label, value_type, options, default_value, is_builtin, sort_order)
    VALUES (
      ${escapeStr(key)},
      ${escapeStr(label)},
      ${escapeStr(value_type)},
      ${escapeJson(options)},
      ${escapeJson(default_value)},
      FALSE,
      ${maxOrder + 1}
    )
  `);

  // Write-through to IndexedDB
  await idbPut(STORE_ATTRIBUTES, {
    key,
    label,
    value_type,
    options,
    default_value,
    sort_order: maxOrder + 1,
  });

  // Return the created row
  const result = await conn.query(
    `SELECT key, label, value_type, options, default_value, is_builtin, sort_order
     FROM attribute_definitions WHERE key = ${escapeStr(key)}`
  );
  return parseAttrRow(result.toArray()[0]);
}

/**
 * Delete a custom attribute definition. Built-in attributes cannot be deleted.
 */
export async function deleteAttribute(key) {
  const result = await conn.query(
    `SELECT is_builtin FROM attribute_definitions WHERE key = ${escapeStr(key)}`
  );
  const rows = result.toArray();

  if (rows.length === 0) {
    throw new Error(`Attribute '${key}' not found`);
  }
  if (rows[0].is_builtin) {
    throw new Error("Cannot delete built-in attributes");
  }

  await conn.query(
    `DELETE FROM attribute_definitions WHERE key = ${escapeStr(key)}`
  );

  // Remove from IndexedDB
  await idbDelete(STORE_ATTRIBUTES, key);
}

// ── SQL Console ────────────────────────────────────────────────────────

/**
 * Execute an arbitrary SQL query.
 */
export async function executeSql(query) {
  const trimmed = query.trim();
  const result = await conn.query(trimmed);

  // Check if this is a SELECT-style query that returns rows
  const isSelect =
    /^\s*(SELECT|WITH|DESCRIBE|SHOW|EXPLAIN|PRAGMA)/i.test(trimmed);

  if (isSelect && result.schema && result.schema.fields.length > 0) {
    const { columns, rows } = arrowToRows(result);
    return { columns, rows, row_count: rows.length };
  }

  // Non-select (INSERT, UPDATE, DELETE, CREATE, etc.)
  // Detect annotation UPDATEs and sync affected rows to IndexedDB
  const annotationTables = [];
  if (/\bupdate\b/i.test(trimmed) && /\bannotations\b/i.test(trimmed)) {
    if (/\btcg_cards\b/i.test(trimmed)) {
      annotationTables.push("tcg_cards");
    }
    if (/\bpocket_cards\b/i.test(trimmed)) {
      annotationTables.push("pocket_cards");
    }
  }

  let syncCount = 0;
  for (const table of annotationTables) {
    // Get all current IndexedDB annotation IDs
    const idbRows = await idbGetAll(STORE_ANNOTATIONS);
    const idbIds = new Set(idbRows.map((r) => r.id));

    // Read all non-empty annotations from this table
    const nonEmpty = await conn.query(
      `SELECT id, annotations FROM ${table} WHERE annotations != '{}'`
    );
    const dbRows = nonEmpty.toArray();

    // Upsert each non-empty annotation to IndexedDB
    for (const row of dbRows) {
      const data =
        typeof row.annotations === "string"
          ? JSON.parse(row.annotations)
          : row.annotations || {};
      await idbPut(STORE_ANNOTATIONS, { id: row.id, data });
      idbIds.delete(row.id);
      syncCount++;
    }

    // Remove IndexedDB entries whose table row now has '{}' (annotation was cleared)
    // Only delete IDs that belong to this table (they exist in the table but weren't in non-empty results)
    for (const orphanId of idbIds) {
      const inTable = await conn.query(
        `SELECT id FROM ${table} WHERE id = ${escapeStr(orphanId)}`
      );
      if (inTable.toArray().length > 0) {
        await idbDelete(STORE_ANNOTATIONS, orphanId);
      }
    }
  }

  const message = syncCount > 0
    ? `Query executed successfully. Synced ${syncCount} annotation(s) to persistent storage.`
    : "Query executed successfully";

  return {
    columns: [],
    rows: [],
    row_count: 0,
    message,
  };
}

// ── Mutable Table Sync ─────────────────────────────────────────────────

export async function exportAllAnnotations() {
  const results = {};
  const queries = await Promise.all([
    conn.query("SELECT id, annotations FROM tcg_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM pocket_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
  ]);
  for (const result of queries) {
    for (const row of result.toArray()) {
      const data = safeParseJson(row.annotations, {});
      if (Object.keys(data).length > 0) results[row.id] = data;
    }
  }
  return results;
}

/**
 * Sync the mutable DuckDB tables (annotations + tcg_cards/pocket_cards) back to
 * IndexedDB. Call this after SQL console mutations to persist changes.
 * Returns { annotationsSynced, customCardsSynced, customCardsData } where
 * customCardsData is the { cards: [...] } payload ready for GitHub.
 */
export async function syncMutableTablesToIndexedDB() {
  const results = { annotationsSynced: 0, customCardsSynced: 0, customCardsData: null };

  // 1. Upsert all non-empty annotations from both card tables
  const annQueries = await Promise.all([
    conn.query("SELECT id, annotations FROM tcg_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM pocket_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
  ]);

  for (const result of annQueries) {
    for (const row of result.toArray()) {
      const data = safeParseJson(row.annotations, {});
      if (Object.keys(data).length > 0) {
        await idbPut(STORE_ANNOTATIONS, { id: row.id, data });
        results.annotationsSynced++;
      }
    }
  }

  // 2. Full sync of custom cards — clear store and repopulate from DuckDB
  await idbClearStore(STORE_CUSTOM_CARDS);

  const parseArr = (val) => {
    if (!val || val === "[]") return [];
    try { return JSON.parse(val); } catch { return val ? [val] : []; }
  };

  // Helper to build a serializable card object from a DB row
  function rowToCardJson(row, tableHint) {
    const ann = safeParseJson(row.annotations, {});
    const card = {
      id: row.id || "",
      name: row.name || "",
      source: row.source || "",
      _table: tableHint,
      art_style: parseArr(row.art_style),
      main_character: parseArr(row.main_character),
      background_pokemon: parseArr(row.background_pokemon),
      background_humans: parseArr(row.background_humans),
      additional_characters: parseArr(row.additional_characters),
      evolution_line: row.evolution_line || "",
      background_details: parseArr(row.background_details),
      emotion: row.emotion || "",
      pose: row.pose || "",
      camera_angle: row.camera_angle || "",
      items: parseArr(row.items),
      actions: row.actions || "",
      perspective: row.perspective || "",
      weather: row.weather || "",
      environment: row.environment || "",
      storytelling: row.storytelling || "",
      card_locations: row.card_locations || "",
      pkmn_region: row.pkmn_region || "",
      card_region: row.card_region || "",
      primary_color: row.primary_color || "",
      secondary_color: row.secondary_color || "",
      shape: row.shape || "",
      image_override: row.image_override || "",
      video_game: row.video_game || "",
      video_game_location: row.video_game_location || "",
      video_appearance: row.video_appearance === true,
      shorts_appearance: row.shorts_appearance === true,
      region_appearance: row.region_appearance === true,
      thumbnail_used: row.thumbnail_used === true,
      video_url: row.video_url || "",
      video_title: row.video_title || "",
      video_type: parseArr(row.video_type),
      video_region: parseArr(row.video_region),
      video_location: parseArr(row.video_location),
      top_10_themes: row.top_10_themes || "",
      wtpc_episode: row.wtpc_episode || "",
      pocket_exclusive: row.pocket_exclusive === true,
      owned: row.owned === true,
      unique_id: row.unique_id || "",
      notes: row.notes || "",
      card_subcategory: parseArr(row.card_subcategory),
      held_item: parseArr(row.held_item),
      pokeball: parseArr(row.pokeball),
      evolution_items: parseArr(row.evolution_items),
      berries: parseArr(row.berries),
      holiday_theme: parseArr(row.holiday_theme),
      multi_card: parseArr(row.multi_card),
      trainer_card_type: row.trainer_card_type || "",
      trainer_card_subgroup: parseArr(row.trainer_card_subgroup),
      stamp: row.stamp || "",
      card_border: row.card_border || "",
      energy_type: row.energy_type || "",
      rival_group: row.rival_group || "",
      annotations: ann,
    };
    if (tableHint === 'tcg') {
      Object.assign(card, {
        supertype: normalizeSupertypeDisplay(row.supertype || ""),
        subtypes: parseArr(row.subtypes),
        hp: row.hp || "",
        types: parseArr(row.types),
        evolves_from: row.evolves_from || "",
        rarity: row.rarity || "",
        special_rarity: row.special_rarity || "",
        alt_name: row.alt_name || "",
        artist: row.artist || "",
        set_id: row.set_id || "",
        set_name: row.set_name || "",
        set_series: row.set_series || "",
        number: row.number || "",
        regulation_mark: row.regulation_mark || "",
        image_small: row.image_small || "",
        image_large: row.image_large || "",
      });
    } else {
      Object.assign(card, {
        set_id: row.set_id || "",
        rarity: row.rarity || "",
        card_type: row.card_type || "",
        element: row.element || "",
        hp: typeof row.hp === "bigint" ? Number(row.hp) : (row.hp || ""),
        stage: row.stage || "",
        retreat_cost: typeof row.retreat_cost === "bigint" ? Number(row.retreat_cost) : (row.retreat_cost || ""),
        weakness: row.weakness || "",
        evolves_from: row.evolves_from || "",
        packs: parseArr(row.packs),
        image_url: row.image_url || "",
        illustrator: row.illustrator || "",
      });
    }
    return card;
  }

  const cardsForJson = [];

  // Sync custom tcg_cards
  const tcgResult = await conn.query("SELECT * FROM tcg_cards WHERE is_custom = TRUE");
  for (const row of tcgResult.toArray()) {
    const card = rowToCardJson(row, 'tcg');
    await idbPut(STORE_CUSTOM_CARDS, card);
    cardsForJson.push(card);
    results.customCardsSynced++;
  }

  // Sync custom pocket_cards
  const pocketResult = await conn.query("SELECT * FROM pocket_cards WHERE is_custom = TRUE");
  for (const row of pocketResult.toArray()) {
    const card = rowToCardJson(row, 'pocket');
    await idbPut(STORE_CUSTOM_CARDS, card);
    cardsForJson.push(card);
    results.customCardsSynced++;
  }

  results.customCardsData = { cards: cardsForJson };
  return results;
}

// ── Ingest (disabled) ──────────────────────────────────────────────────

/**
 * Not available in the static site. Data is refreshed via GitHub Actions.
 */
export async function triggerIngest() {
  throw new Error(
    "Data updates are handled via GitHub Actions, not available in the browser."
  );
}

// ── Custom Cards ───────────────────────────────────────────────────────

/**
 * Add a custom set (if it doesn't already exist).
 * Custom sets use IDs prefixed with "custom-".
 */
export async function addCustomSet(set) {
  if (!set.id.startsWith("custom-")) {
    throw new Error("Custom set ID must start with 'custom-'");
  }

  // Check if set already exists
  const existing = await conn.query(
    `SELECT id FROM sets WHERE id = ${escapeStr(set.id)}`
  );
  if (existing.numRows > 0) {
    return; // Set already exists
  }

  const setData = {
    id: set.id,
    name: set.name || set.id,
    series: set.series || "Custom",
    release_date: set.release_date || new Date().toISOString().split("T")[0],
  };

  // Insert into DuckDB
  await conn.query(`
    INSERT INTO sets (id, name, series, release_date)
    VALUES (
      ${escapeStr(setData.id)},
      ${escapeStr(setData.name)},
      ${escapeStr(setData.series)},
      ${escapeStr(setData.release_date)}
    )
  `);

  // Write-through to IndexedDB
  await idbPut(STORE_CUSTOM_SETS, setData);
}

// ── Internal card insert helpers ────────────────────────────────────────

const TCG_COLUMN_FIELDS = new Set([
  "id","name","supertype","subtypes","hp","types","evolves_from",
  "rarity","special_rarity","alt_name","artist","set_id","set_name","set_series","number",
  "regulation_mark","image_small","image_large","source","is_custom","_table",
  ...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS,
]);

const POCKET_COLUMN_FIELDS = new Set([
  "id","name","set_id","number","rarity","card_type","element","hp","stage",
  "retreat_cost","weakness","evolves_from","packs","image_url","image_filename",
  "illustrator","raw_data","source","is_custom","_table",
  ...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS,
]);

function buildCardInsertValues(card, columnFields) {
  const arrayVal = (key) => {
    const arr = normalizeToArray(card[key]);
    return arr ? JSON.stringify(arr) : '';
  };
  const strVal = (key) => card[key] != null ? String(card[key]) : '';
  const boolVal = (key) => card[key] === true;
  const evolutionLine = (() => {
    const arr = normalizeToArray(card.evolution_line);
    return arr ? arr.join(' → ') : '';
  })();
  const annotations = {};
  for (const [k, v] of Object.entries(card)) {
    if (columnFields.has(k)) continue;
    if (v === '' || v === null || v === undefined) continue;
    annotations[k] = v;
  }
  return { arrayVal, strVal, boolVal, evolutionLine, annotations };
}

async function _insertTcgCard(card) {
  const { arrayVal, strVal, boolVal, evolutionLine, annotations } =
    buildCardInsertValues(card, TCG_COLUMN_FIELDS);
  const subtypesStr = Array.isArray(card.subtypes) ? JSON.stringify(card.subtypes) : (card.subtypes || '[]');
  const typesStr = Array.isArray(card.types) ? JSON.stringify(card.types) : (card.types || '[]');
  const hpStr = card.hp != null ? String(card.hp) : '';
  await conn.query(`
    INSERT INTO tcg_cards (
      id, name, supertype, subtypes, hp, types, evolves_from,
      rarity, special_rarity, alt_name, artist,
      set_id, set_name, set_series, number,
      regulation_mark, image_small, image_large, source, is_custom,
      art_style, main_character, background_pokemon, background_humans,
      additional_characters, evolution_line, background_details,
      emotion, pose, actions, camera_angle, perspective,
      primary_color, secondary_color, storytelling,
      weather, environment, card_region, card_locations, pkmn_region,
      items, held_item, pokeball, evolution_items, berries, card_subcategory,
      trainer_card_type, trainer_card_subgroup, stamp, card_border, energy_type, rival_group,
      holiday_theme, multi_card, shape,
      video_game, video_game_location,
      video_appearance, shorts_appearance, region_appearance, thumbnail_used,
      video_url, video_title, video_type, video_region, video_location,
      top_10_themes, wtpc_episode, pocket_exclusive, owned, unique_id, notes,
      image_override, annotations
    ) VALUES (
      ${escapeStr(card.id)}, ${escapeStr(card.name || '')}, ${escapeStr(card.supertype || '')},
      ${escapeStr(subtypesStr)}, ${escapeStr(hpStr)}, ${escapeStr(typesStr)},
      ${escapeStr(card.evolves_from || '')}, ${escapeStr(card.rarity || '')},
      ${escapeStr(card.special_rarity || '')}, ${escapeStr(card.alt_name || '')},
      ${escapeStr(card.artist || '')},
      ${escapeStr(card.set_id || '')}, ${escapeStr(card.set_name || '')}, ${escapeStr(card.set_series || '')},
      ${escapeStr(card.number || '')}, ${escapeStr(card.regulation_mark || '')},
      ${escapeStr(card.image_small || card.image_url || '')}, ${escapeStr(card.image_large || card.image_url || '')},
      ${escapeStr(card.source || 'TCG')}, TRUE,
      ${escapeStr(arrayVal('art_style'))}, ${escapeStr(arrayVal('main_character'))},
      ${escapeStr(arrayVal('background_pokemon'))}, ${escapeStr(arrayVal('background_humans'))},
      ${escapeStr(arrayVal('additional_characters'))}, ${escapeStr(evolutionLine)},
      ${escapeStr(arrayVal('background_details'))},
      ${escapeStr(strVal('emotion'))}, ${escapeStr(strVal('pose'))},
      ${escapeStr(strVal('actions'))}, ${escapeStr(strVal('camera_angle'))},
      ${escapeStr(strVal('perspective'))},
      ${escapeStr(strVal('primary_color'))}, ${escapeStr(strVal('secondary_color'))},
      ${escapeStr(strVal('storytelling'))},
      ${escapeStr(strVal('weather'))}, ${escapeStr(strVal('environment'))},
      ${escapeStr(strVal('card_region'))}, ${escapeStr(strVal('card_locations'))},
      ${escapeStr(strVal('pkmn_region'))},
      ${escapeStr(arrayVal('items'))}, ${escapeStr(arrayVal('held_item'))},
      ${escapeStr(arrayVal('pokeball'))},
      ${escapeStr(arrayVal('evolution_items'))}, ${escapeStr(arrayVal('berries'))},
      ${escapeStr(arrayVal('card_subcategory'))},
      ${escapeStr(strVal('trainer_card_type'))}, ${escapeStr(arrayVal('trainer_card_subgroup'))},
      ${escapeStr(strVal('stamp'))}, ${escapeStr(strVal('card_border'))},
      ${escapeStr(strVal('energy_type'))}, ${escapeStr(strVal('rival_group'))},
      ${escapeStr(arrayVal('holiday_theme'))}, ${escapeStr(arrayVal('multi_card'))},
      ${escapeStr(strVal('shape'))},
      ${escapeStr(strVal('video_game'))}, ${escapeStr(strVal('video_game_location'))},
      ${boolVal('video_appearance')}, ${boolVal('shorts_appearance')}, ${boolVal('region_appearance')},
      ${boolVal('thumbnail_used')},
      ${escapeStr(strVal('video_url'))}, ${escapeStr(strVal('video_title'))},
      ${escapeStr(arrayVal('video_type'))}, ${escapeStr(arrayVal('video_region'))}, ${escapeStr(arrayVal('video_location'))},
      ${escapeStr(strVal('top_10_themes'))}, ${escapeStr(strVal('wtpc_episode'))},
      ${boolVal('pocket_exclusive')}, ${boolVal('owned')},
      ${escapeStr(strVal('unique_id'))}, ${escapeStr(strVal('notes'))},
      ${escapeStr(strVal('image_override'))},
      ${escapeJson(annotations)}
    )
  `);
}

async function _insertPocketCard(card) {
  const { arrayVal, strVal, boolVal, evolutionLine, annotations } =
    buildCardInsertValues(card, POCKET_COLUMN_FIELDS);
  const packsStr = Array.isArray(card.packs) ? JSON.stringify(card.packs) : (card.packs || '[]');
  await conn.query(`
    INSERT INTO pocket_cards (
      id, name, set_id, number, rarity, card_type, element, hp, stage,
      retreat_cost, weakness, evolves_from,
      packs, image_url, illustrator, source, is_custom,
      art_style, main_character, background_pokemon, background_humans,
      additional_characters, evolution_line, background_details,
      emotion, pose, actions, camera_angle, perspective,
      primary_color, secondary_color, storytelling,
      weather, environment, card_region, card_locations, pkmn_region,
      items, held_item, pokeball, evolution_items, berries, card_subcategory,
      trainer_card_type, trainer_card_subgroup, stamp, card_border, energy_type, rival_group,
      holiday_theme, multi_card, shape,
      video_game, video_game_location,
      video_appearance, shorts_appearance, region_appearance, thumbnail_used,
      video_url, video_title, video_type, video_region, video_location,
      top_10_themes, wtpc_episode, pocket_exclusive, owned, unique_id, notes,
      image_override, annotations
    ) VALUES (
      ${escapeStr(card.id)}, ${escapeStr(card.name || '')},
      ${escapeStr(card.set_id || '')}, ${escapeStr(card.number != null ? String(card.number) : '')},
      ${escapeStr(card.rarity || '')}, ${escapeStr(card.card_type || '')},
      ${escapeStr(card.element || '')}, ${escapeStr(card.hp != null ? String(card.hp) : '')},
      ${escapeStr(card.stage || '')}, ${escapeStr(card.retreat_cost != null ? String(card.retreat_cost) : '')},
      ${escapeStr(card.weakness || '')}, ${escapeStr(card.evolves_from || '')},
      ${escapeStr(packsStr)}, ${escapeStr(card.image_url || '')}, ${escapeStr(card.illustrator || '')},
      'Pocket', TRUE,
      ${escapeStr(arrayVal('art_style'))}, ${escapeStr(arrayVal('main_character'))},
      ${escapeStr(arrayVal('background_pokemon'))}, ${escapeStr(arrayVal('background_humans'))},
      ${escapeStr(arrayVal('additional_characters'))}, ${escapeStr(evolutionLine)},
      ${escapeStr(arrayVal('background_details'))},
      ${escapeStr(strVal('emotion'))}, ${escapeStr(strVal('pose'))},
      ${escapeStr(strVal('actions'))}, ${escapeStr(strVal('camera_angle'))},
      ${escapeStr(strVal('perspective'))},
      ${escapeStr(strVal('primary_color'))}, ${escapeStr(strVal('secondary_color'))},
      ${escapeStr(strVal('storytelling'))},
      ${escapeStr(strVal('weather'))}, ${escapeStr(strVal('environment'))},
      ${escapeStr(strVal('card_region'))}, ${escapeStr(strVal('card_locations'))},
      ${escapeStr(strVal('pkmn_region'))},
      ${escapeStr(arrayVal('items'))}, ${escapeStr(arrayVal('held_item'))},
      ${escapeStr(arrayVal('pokeball'))},
      ${escapeStr(arrayVal('evolution_items'))}, ${escapeStr(arrayVal('berries'))},
      ${escapeStr(arrayVal('card_subcategory'))},
      ${escapeStr(strVal('trainer_card_type'))}, ${escapeStr(arrayVal('trainer_card_subgroup'))},
      ${escapeStr(strVal('stamp'))}, ${escapeStr(strVal('card_border'))},
      ${escapeStr(strVal('energy_type'))}, ${escapeStr(strVal('rival_group'))},
      ${escapeStr(arrayVal('holiday_theme'))}, ${escapeStr(arrayVal('multi_card'))},
      ${escapeStr(strVal('shape'))},
      ${escapeStr(strVal('video_game'))}, ${escapeStr(strVal('video_game_location'))},
      ${boolVal('video_appearance')}, ${boolVal('shorts_appearance')}, ${boolVal('region_appearance')},
      ${boolVal('thumbnail_used')},
      ${escapeStr(strVal('video_url'))}, ${escapeStr(strVal('video_title'))},
      ${escapeStr(arrayVal('video_type'))}, ${escapeStr(arrayVal('video_region'))}, ${escapeStr(arrayVal('video_location'))},
      ${escapeStr(strVal('top_10_themes'))}, ${escapeStr(strVal('wtpc_episode'))},
      ${boolVal('pocket_exclusive')}, ${boolVal('owned')},
      ${escapeStr(strVal('unique_id'))}, ${escapeStr(strVal('notes'))},
      ${escapeStr(strVal('image_override'))},
      ${escapeJson(annotations)}
    )
  `);
}

// ── Custom Card CRUD ────────────────────────────────────────────────────

/**
 * Add a custom TCG card to tcg_cards (is_custom = TRUE).
 */
export async function addTcgCard(card) {
  if (!card.id) throw new Error("Card must have an id");
  const existing = await conn.query(
    `SELECT id FROM tcg_cards WHERE id = ${escapeStr(card.id)}`
  );
  if (existing.numRows > 0) throw new Error(`Card with ID '${card.id}' already exists`);
  await _insertTcgCard(card);
  if (card.source) customSourceNames.add(card.source);
  await idbPut(STORE_CUSTOM_CARDS, { ...card, _table: 'tcg' });
  return card;
}

/**
 * Add a custom Pocket card to pocket_cards (is_custom = TRUE).
 */
export async function addPocketCard(card) {
  if (!card.id) throw new Error("Card must have an id");
  const existing = await conn.query(
    `SELECT id FROM pocket_cards WHERE id = ${escapeStr(card.id)}`
  );
  if (existing.numRows > 0) throw new Error(`Card with ID '${card.id}' already exists`);
  await _insertPocketCard(card);
  await idbPut(STORE_CUSTOM_CARDS, { ...card, _table: 'pocket' });
  return card;
}

/**
 * Backward-compatible router — delegates to addTcgCard or addPocketCard.
 */
export async function addCustomCard(card) {
  if (card._table === 'pocket') return addPocketCard(card);
  return addTcgCard(card);
}

/**
 * Delete multiple custom cards by ID from DuckDB + IndexedDB.
 * Only removes cards that have is_custom = TRUE; skips API cards.
 * Returns the list of IDs that were actually deleted.
 */
export async function deleteCardsById(cardIds) {
  const deleted = [];
  for (const id of [...cardIds]) {
    const escapedId = escapeStr(id);
    const inTcg = (await conn.query(
      `SELECT id FROM tcg_cards WHERE id = ${escapedId} AND is_custom = TRUE`
    )).toArray().length > 0;
    const inPocket = !inTcg && (await conn.query(
      `SELECT id FROM pocket_cards WHERE id = ${escapedId} AND is_custom = TRUE`
    )).toArray().length > 0;
    if (!inTcg && !inPocket) continue;
    if (inTcg) await conn.query(`DELETE FROM tcg_cards WHERE id = ${escapedId} AND is_custom = TRUE`);
    if (inPocket) await conn.query(`DELETE FROM pocket_cards WHERE id = ${escapedId} AND is_custom = TRUE`);
    await idbDelete(STORE_CUSTOM_CARDS, id);
    await idbDelete(STORE_ANNOTATIONS, id);
    deleted.push(id);
  }
  if (deleted.length > 0) {
    await idbPut(STORE_ATTRIBUTES, { key: "custom_cards_initialized", value: true });
  }
  return deleted;
}
