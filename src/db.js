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
  STAMP_OPTIONS, BACKGROUND_HUMANS_OPTIONS,
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
  return "'" + String(s).replace(/'/g, "''") + "'";
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

function isCustomSource(source) {
  return customSourceNames.has(source);
}

export function getCustomSourceNames() {
  return [...customSourceNames].sort();
}

// Promoted annotation column names (array-valued ones stored as JSON strings)
const PROMOTED_ARRAY_FIELDS = new Set([
  "art_style","main_character","background_pokemon","background_humans",
  "additional_characters","background_details",
  "card_subcategory","evolution_items","berries","holiday_theme","multi_card","trainer_card_subgroup",
  "video_type","video_region","video_location",
]);

const PROMOTED_STRING_FIELDS = [
  "emotion","pose","camera_angle","items","actions","perspective",
  "weather","environment","storytelling","card_locations","pkmn_region","card_region",
  "primary_color","secondary_color","shape",
  "video_game","video_url","video_title","unique_id","notes","evolution_line",
  "held_item","pokeball","trainer_card_type","stamp",
];

const PROMOTED_BOOL_FIELDS = ["video_appearance","thumbnail_used","owned","pocket_exclusive"];

/**
 * Build an annotations-like object from promoted custom_cards columns.
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
    const val = row[key];
    if (val) result[key] = val;
  }
  for (const key of PROMOTED_BOOL_FIELDS) {
    if (row[key] === true) result[key] = true;
  }
  return result;
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
  if (import.meta.env.DEV) {
    const cdnWorkerUrl = duckdb.getJsDelivrBundles().mvp.mainWorker;
    workerBlobUrl = URL.createObjectURL(
      new Blob([`importScripts("${cdnWorkerUrl}");`], { type: "text/javascript" })
    );
  } else {
    const mainWorkerUrl = toAbsoluteUrl(bundle.mainWorker);
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
    fetch(`${base}data/custom_cards.json`),
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

  // 3. Create tables from Parquet (include annotations column directly)
  await conn.query(
    "CREATE OR REPLACE TABLE cards AS SELECT *, '{}'::JSON AS annotations FROM 'cards.parquet'"
  );
  await conn.query(
    "CREATE OR REPLACE TABLE sets AS SELECT * FROM 'sets.parquet'"
  );

  // Create pokemon_metadata table (empty if parquet not available)
  if (pokemonMetaResp.ok) {
    await conn.query(
      "CREATE OR REPLACE TABLE pokemon_metadata AS SELECT * FROM 'pokemon_metadata.parquet'"
    );
    // Add new columns if they don't exist (for older parquet files)
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

  // Create pocket_cards table
  if (pocketCardsResp.ok) {
    const pocketCardsBuf = new Uint8Array(await pocketCardsResp.arrayBuffer());
    await db.registerFileBuffer("pocket_cards.parquet", pocketCardsBuf);
    await conn.query(
      "CREATE OR REPLACE TABLE pocket_cards AS SELECT *, '{}'::JSON AS annotations FROM 'pocket_cards.parquet'"
    );
  } else {
    await conn.query(`
      CREATE OR REPLACE TABLE pocket_cards (
        id              VARCHAR PRIMARY KEY,
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
        annotations     JSON DEFAULT '{}'
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

  // Create custom_cards table from JSON
  await conn.query(`
    CREATE OR REPLACE TABLE custom_cards (
      id              VARCHAR PRIMARY KEY,
      name            VARCHAR,
      supertype       VARCHAR,
      subtypes        VARCHAR,
      hp              VARCHAR,
      types           VARCHAR,
      evolves_from    VARCHAR,
      rarity          VARCHAR,
      special_rarity  VARCHAR,
      alt_name        VARCHAR,
      artist          VARCHAR,
      set_id          VARCHAR,
      set_name        VARCHAR,
      set_series      VARCHAR,
      number          VARCHAR,
      regulation_mark VARCHAR,
      image_small     VARCHAR,
      image_large     VARCHAR,
      source          VARCHAR,
      -- promoted annotation columns
      art_style              VARCHAR,
      main_character         VARCHAR,
      background_pokemon     VARCHAR,
      background_humans      VARCHAR,
      additional_characters  VARCHAR,
      evolution_line         VARCHAR,
      background_details     VARCHAR,
      emotion                VARCHAR,
      pose                   VARCHAR,
      camera_angle           VARCHAR,
      items                  VARCHAR,
      actions                VARCHAR,
      perspective            VARCHAR,
      weather_environment    VARCHAR,
      weather                VARCHAR,
      environment            VARCHAR,
      storytelling           VARCHAR,
      card_locations         VARCHAR,
      pkmn_region            VARCHAR,
      card_region            VARCHAR,
      primary_color          VARCHAR,
      secondary_color        VARCHAR,
      shape                  VARCHAR,
      video_game             VARCHAR,
      video_appearance       BOOLEAN DEFAULT FALSE,
      thumbnail_used         BOOLEAN DEFAULT FALSE,
      video_url              VARCHAR,
      video_title            VARCHAR,
      unique_id              VARCHAR,
      owned                  BOOLEAN DEFAULT FALSE,
      notes                  VARCHAR,
      card_subcategory       VARCHAR,
      held_item              VARCHAR,
      pokeball               VARCHAR,
      evolution_items        VARCHAR,
      berries                VARCHAR,
      holiday_theme          VARCHAR,
      multi_card             VARCHAR,
      trainer_card_type      VARCHAR,
      trainer_card_subgroup  VARCHAR,
      video_type             VARCHAR,
      video_region           VARCHAR,
      video_location         VARCHAR,
      pocket_exclusive       BOOLEAN DEFAULT FALSE,
      stamp                  VARCHAR,
      annotations            JSON DEFAULT '{}'
    )
  `);

  // Populate custom_cards from JSON
  if (customCardsResp.ok) {
    try {
      const customJson = await customCardsResp.json();
      const customCards = customJson.cards || [];

      // Normalize a value to an array (or null)
      function normalizeToArray(val) {
        if (val === null || val === undefined) return null;
        if (Array.isArray(val)) return val;
        if (typeof val === 'string' && val !== '') return [val];
        return null;
      }

      // All known column fields
      const allColumnFields = new Set([
        "id","name","supertype","subtypes","hp","types","evolves_from",
        "rarity","special_rarity","alt_name","artist","set_id","set_name","set_series","number",
        "regulation_mark","image_small","image_large","source",
        "art_style","main_character","background_pokemon","background_humans",
        "additional_characters","evolution_line","background_details",
        "emotion","pose","camera_angle","items","actions","perspective",
        "weather_environment","weather","environment","storytelling","card_locations","pkmn_region","card_region",
        "primary_color","secondary_color","shape",
        "video_game","video_appearance","thumbnail_used","video_url","video_title",
        "unique_id","owned","notes",
        "card_subcategory","held_item","pokeball","evolution_items","berries",
        "holiday_theme","multi_card","trainer_card_type","trainer_card_subgroup",
        "video_type","video_region","video_location",
        "pocket_exclusive","stamp",
      ]);

      // Fields that should be stored as JSON array strings
      const arrayColumnFields = new Set([
        "art_style","main_character","background_pokemon","background_humans",
        "additional_characters","background_details",
        "card_subcategory","evolution_items","berries","holiday_theme","multi_card","trainer_card_subgroup",
        "video_type","video_region","video_location",
      ]);

      for (const card of customCards) {
        if (!card.id || !card.source) continue;

        // Stringify arrays for VARCHAR columns
        const subtypesStr = Array.isArray(card.subtypes) ? JSON.stringify(card.subtypes) : (card.subtypes || '[]');
        const typesStr = Array.isArray(card.types) ? JSON.stringify(card.types) : (card.types || '[]');
        const hpStr = card.hp != null ? String(card.hp) : '';

        // Prepare promoted column values
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

        // Build annotations from truly unknown fields
        const annotations = {};
        for (const [k, v] of Object.entries(card)) {
          if (allColumnFields.has(k)) continue;
          if (v === '' || v === null || v === undefined) continue;
          annotations[k] = v;
        }

        await conn.query(`
          INSERT INTO custom_cards (
            id, name, supertype, subtypes, hp, types, evolves_from,
            rarity, special_rarity, alt_name, artist, set_id, set_name, set_series, number,
            regulation_mark, image_small, image_large, source,
            art_style, main_character, background_pokemon, background_humans,
            additional_characters, evolution_line, background_details,
            emotion, pose, camera_angle, items, actions, perspective,
            weather_environment, weather, environment, storytelling, card_locations, pkmn_region, card_region,
            primary_color, secondary_color, shape,
            video_game, video_appearance, thumbnail_used, video_url, video_title,
            unique_id, owned, notes,
            card_subcategory, held_item, pokeball, evolution_items, berries,
            holiday_theme, multi_card, trainer_card_type, trainer_card_subgroup,
            video_type, video_region, video_location,
            pocket_exclusive, stamp,
            annotations
          ) VALUES (
            ${escapeStr(card.id)}, ${escapeStr(card.name || '')}, ${escapeStr(card.supertype || '')},
            ${escapeStr(subtypesStr)}, ${escapeStr(hpStr)}, ${escapeStr(typesStr)},
            ${escapeStr(card.evolves_from || '')}, ${escapeStr(card.rarity || '')},
            ${escapeStr(card.special_rarity || '')}, ${escapeStr(card.alt_name || '')},
            ${escapeStr(card.artist || '')},
            ${escapeStr(card.set_id || '')}, ${escapeStr(card.set_name || '')}, ${escapeStr(card.set_series || '')},
            ${escapeStr(card.number || '')}, ${escapeStr(card.regulation_mark || '')},
            ${escapeStr(card.image_small || '')}, ${escapeStr(card.image_large || '')},
            ${escapeStr(card.source)},
            ${escapeStr(arrayVal('art_style'))}, ${escapeStr(arrayVal('main_character'))},
            ${escapeStr(arrayVal('background_pokemon'))}, ${escapeStr(arrayVal('background_humans'))},
            ${escapeStr(arrayVal('additional_characters'))}, ${escapeStr(evolutionLine)},
            ${escapeStr(arrayVal('background_details'))},
            ${escapeStr(strVal('emotion'))}, ${escapeStr(strVal('pose'))},
            ${escapeStr(strVal('camera_angle'))}, ${escapeStr(strVal('items'))},
            ${escapeStr(strVal('actions'))}, ${escapeStr(strVal('perspective'))},
            ${escapeStr(strVal('weather_environment'))}, ${escapeStr(strVal('weather'))}, ${escapeStr(strVal('environment'))}, ${escapeStr(strVal('storytelling'))},
            ${escapeStr(strVal('card_locations'))}, ${escapeStr(strVal('pkmn_region'))}, ${escapeStr(strVal('card_region'))},
            ${escapeStr(strVal('primary_color'))}, ${escapeStr(strVal('secondary_color'))},
            ${escapeStr(strVal('shape'))},
            ${escapeStr(strVal('video_game'))}, ${boolVal('video_appearance')}, ${boolVal('thumbnail_used')},
            ${escapeStr(strVal('video_url'))}, ${escapeStr(strVal('video_title'))},
            ${escapeStr(strVal('unique_id'))}, ${boolVal('owned')},
            ${escapeStr(strVal('notes'))},
            ${escapeStr(arrayVal('card_subcategory'))}, ${escapeStr(strVal('held_item'))},
            ${escapeStr(strVal('pokeball'))}, ${escapeStr(arrayVal('evolution_items'))},
            ${escapeStr(arrayVal('berries'))}, ${escapeStr(arrayVal('holiday_theme'))},
            ${escapeStr(arrayVal('multi_card'))}, ${escapeStr(strVal('trainer_card_type'))},
            ${escapeStr(arrayVal('trainer_card_subgroup'))},
            ${escapeStr(arrayVal('video_type'))}, ${escapeStr(arrayVal('video_region'))}, ${escapeStr(arrayVal('video_location'))},
            ${boolVal('pocket_exclusive')}, ${escapeStr(strVal('stamp'))},
            ${escapeStr(JSON.stringify(annotations))}
          )
        `);
      }
    } catch (e) {
      console.warn("Could not parse custom_cards.json:", e.message);
    }
  }

  // Load annotations from GitHub-committed annotations.json
  try {
    const annResp = await fetch(`${base}data/annotations.json`);
    if (annResp.ok) {
      const annData = await annResp.json();
      for (const [cardId, data] of Object.entries(annData)) {
        const escaped = escapeStr(JSON.stringify(data));
        const escapedId = escapeStr(cardId);
        await conn.query(`UPDATE cards SET annotations = ${escaped} WHERE id = ${escapedId}`);
        await conn.query(`UPDATE pocket_cards SET annotations = ${escaped} WHERE id = ${escapedId}`);
        await conn.query(`UPDATE custom_cards SET annotations = ${escaped} WHERE id = ${escapedId}`);
      }
    }
  } catch (e) {
    console.warn("Could not load annotations.json:", e.message);
  }

  // Populate customSourceNames from distinct source values
  const sourceResult = await conn.query(
    "SELECT DISTINCT source FROM custom_cards WHERE source IS NOT NULL AND source != ''"
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
      ('pkmn_region',      'Pok\\u00e9mon Region', 'text',  'null', '""',     TRUE, 26),
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
      ('video_location', 'Video Location', 'text', 'null', '""', TRUE, 39)
  `);

  // 6. Hydrate from IndexedDB
  await hydrateFromIndexedDB();
  } catch (e) {
    throw new Error("Loading card data: " + (e?.message || e));
  }

  initialized = true;
}

async function hydrateFromIndexedDB() {
  // Hydrate annotations (update all card tables — only one will match per ID)
  const annotations = await idbGetAll(STORE_ANNOTATIONS);
  for (const row of annotations) {
    const escaped = escapeStr(JSON.stringify(row.data));
    const escapedId = escapeStr(row.id);
    await conn.query(
      `UPDATE cards SET annotations = ${escaped} WHERE id = ${escapedId}`
    );
    await conn.query(
      `UPDATE pocket_cards SET annotations = ${escaped} WHERE id = ${escapedId}`
    );
    await conn.query(
      `UPDATE custom_cards SET annotations = ${escaped} WHERE id = ${escapedId}`
    );
  }

  // Hydrate custom attributes
  const attrs = await idbGetAll(STORE_ATTRIBUTES);
  for (const attr of attrs) {
    // Check if it already exists (a built-in key)
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
          ${escapeStr(JSON.stringify(attr.options))},
          ${escapeStr(JSON.stringify(attr.default_value))},
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

  // Hydrate custom cards into custom_cards table
  const customCards = await idbGetAll(STORE_CUSTOM_CARDS);
  for (const card of customCards) {
    const existing = await conn.query(
      `SELECT id FROM custom_cards WHERE id = ${escapeStr(card.id)}`
    );
    if (existing.numRows === 0) {
      const s = (key) => escapeStr(card[key] || '');
      const b = (key) => card[key] === true;
      const subtypesStr = Array.isArray(card.subtypes) ? JSON.stringify(card.subtypes) : (card.subtypes || '[]');
      const typesStr = Array.isArray(card.types) ? JSON.stringify(card.types) : (card.types || '[]');
      await conn.query(`
        INSERT INTO custom_cards (
          id, name, supertype, subtypes, hp, types, evolves_from,
          rarity, special_rarity, alt_name, artist, set_id, set_name, set_series, number,
          regulation_mark, image_small, image_large, source,
          art_style, main_character, background_pokemon, background_humans,
          additional_characters, evolution_line, background_details,
          emotion, pose, camera_angle, items, actions, perspective,
          weather_environment, weather, environment, storytelling, card_locations, pkmn_region, card_region,
          primary_color, secondary_color, shape,
          video_game, video_appearance, thumbnail_used, video_url, video_title,
          unique_id, owned, notes,
          card_subcategory, held_item, pokeball, evolution_items, berries,
          holiday_theme, multi_card, trainer_card_type, trainer_card_subgroup,
          video_type, video_region, video_location,
          pocket_exclusive, stamp,
          annotations
        ) VALUES (
          ${escapeStr(card.id)}, ${escapeStr(card.name || '')}, ${escapeStr(card.supertype || '')},
          ${escapeStr(subtypesStr)}, ${escapeStr(card.hp != null ? String(card.hp) : '')}, ${escapeStr(typesStr)},
          ${s('evolves_from')}, ${s('rarity')}, ${s('special_rarity')}, ${s('alt_name')}, ${s('artist')},
          ${s('set_id')}, ${s('set_name')}, ${s('set_series')}, ${s('number')},
          ${s('regulation_mark')}, ${s('image_small')}, ${s('image_large')}, ${s('source')},
          ${s('art_style')}, ${s('main_character')}, ${s('background_pokemon')}, ${s('background_humans')},
          ${s('additional_characters')}, ${s('evolution_line')}, ${s('background_details')},
          ${s('emotion')}, ${s('pose')}, ${s('camera_angle')}, ${s('items')}, ${s('actions')}, ${s('perspective')},
          ${s('weather_environment')}, ${s('weather')}, ${s('environment')}, ${s('storytelling')}, ${s('card_locations')}, ${s('pkmn_region')}, ${s('card_region')},
          ${s('primary_color')}, ${s('secondary_color')}, ${s('shape')},
          ${s('video_game')}, ${b('video_appearance')}, ${b('thumbnail_used')}, ${s('video_url')}, ${s('video_title')},
          ${s('unique_id')}, ${b('owned')}, ${s('notes')},
          ${escapeStr(Array.isArray(card.card_subcategory) ? JSON.stringify(card.card_subcategory) : (card.card_subcategory || ''))},
          ${s('held_item')}, ${s('pokeball')},
          ${escapeStr(Array.isArray(card.evolution_items) ? JSON.stringify(card.evolution_items) : (card.evolution_items || ''))},
          ${escapeStr(Array.isArray(card.berries) ? JSON.stringify(card.berries) : (card.berries || ''))},
          ${escapeStr(Array.isArray(card.holiday_theme) ? JSON.stringify(card.holiday_theme) : (card.holiday_theme || ''))},
          ${escapeStr(Array.isArray(card.multi_card) ? JSON.stringify(card.multi_card) : (card.multi_card || ''))},
          ${s('trainer_card_type')},
          ${escapeStr(Array.isArray(card.trainer_card_subgroup) ? JSON.stringify(card.trainer_card_subgroup) : (card.trainer_card_subgroup || ''))},
          ${escapeStr(Array.isArray(card.video_type) ? JSON.stringify(card.video_type) : (card.video_type || ''))},
          ${escapeStr(Array.isArray(card.video_region) ? JSON.stringify(card.video_region) : (card.video_region || ''))},
          ${escapeStr(Array.isArray(card.video_location) ? JSON.stringify(card.video_location) : (card.video_location || ''))},
          ${b('pocket_exclusive')}, ${s('stamp')},
          ${escapeStr(JSON.stringify(card.annotations || {}))}
        )
      `);
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
    rarity = "",
    set_id = "",
    region = "",
    generation = "",
    color = "",
    artist = "",
    evolution_line = "",
    trainer_type = "",
    specialty = "",
    element = "",
    card_type = "",
    stage = "",
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

    // TCG branch: full conditions + pokemon_metadata JOIN
    const tcgConditions = [];
    if (q)              tcgConditions.push(`c.name ILIKE ${escapeStr("%" + q + "%")}`);
    if (supertype)      tcgConditions.push(`c.supertype = ${escapeStr(supertype)}`);
    if (rarity)         tcgConditions.push(`c.rarity = ${escapeStr(rarity)}`);
    if (set_id)         tcgConditions.push(`c.set_id = ${escapeStr(set_id)}`);
    if (artist)         tcgConditions.push(`c.artist = ${escapeStr(artist)}`);
    if (trainer_type)   tcgConditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(trainer_type) + '%')}`);
    if (specialty)      tcgConditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(specialty) + '%')}`);
    if (region)         tcgConditions.push(`c.annotations::JSON->>'pkmn_region' = ${escapeStr(region)}`);
    if (generation)     { const g = parseInt(generation); if (g > 0) tcgConditions.push(`pm.generation = ${g}`); }
    if (color)          tcgConditions.push(`pm.color = ${escapeStr(color)}`);
    if (evolution_line) tcgConditions.push(`pm.evolution_chain = ${escapeStr(evolution_line)}`);
    const tcgWhere = tcgConditions.length ? "WHERE " + tcgConditions.join(" AND ") : "";

    // Pocket branch: excluded if any filter with no Pocket equivalent is active
    let pocketExcluded = !!(set_id || artist || trainer_type || specialty || generation || color || rarity);
    const pocketConditions = [];
    if (q)              pocketConditions.push(`pc.name ILIKE ${escapeStr("%" + q + "%")}`);
    if (region)         pocketConditions.push(`pc.annotations::JSON->>'pkmn_region' = ${escapeStr(region)}`);
    if (evolution_line) pocketConditions.push(`pc.annotations::JSON->>'evolution_line' = ${escapeStr(evolution_line)}`);

    // Supertype: normalize TCG value to Pocket card_type format
    // TCG uses "Pokémon"/"Trainer"/"Energy"; Pocket uses "pokemon"/"supporter"/"item"/"tool"/"fossil"
    if (supertype && !pocketExcluded) {
      const norm = supertype.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (norm === 'energy') {
        pocketExcluded = true;  // Pocket has no energy cards
      } else if (norm === 'trainer') {
        pocketConditions.push(`LOWER(pc.card_type) IN ('supporter','item','tool','fossil','trainer')`);
      } else {
        pocketConditions.push(`LOWER(pc.card_type) = ${escapeStr(norm)}`);
      }
    }

    const pocketWhere = pocketConditions.length ? "WHERE " + pocketConditions.join(" AND ") : "";

    // Custom branch: excluded if generation or color is active (no equivalent columns)
    const customExcluded = !!(generation || color);
    const customConditions = [];
    if (q)              customConditions.push(`cc.name ILIKE ${escapeStr("%" + q + "%")}`);
    if (rarity)         customConditions.push(`cc.rarity = ${escapeStr(rarity)}`);
    if (supertype)      customConditions.push(`cc.supertype = ${escapeStr(supertype)}`);
    if (set_id)         customConditions.push(`cc.set_id = ${escapeStr(set_id)}`);
    if (artist)         customConditions.push(`cc.artist = ${escapeStr(artist)}`);
    if (trainer_type)   customConditions.push(`cc.subtypes ILIKE ${escapeStr('%' + encodeUnicode(trainer_type) + '%')}`);
    if (specialty)      customConditions.push(`cc.subtypes ILIKE ${escapeStr('%' + encodeUnicode(specialty) + '%')}`);
    if (region)         customConditions.push(`cc.pkmn_region = ${escapeStr(region)}`);
    if (evolution_line) customConditions.push(`cc.evolution_line = ${escapeStr(evolution_line)}`);
    const customWhere = customConditions.length ? "WHERE " + customConditions.join(" AND ") : "";

    const tcgSelect = `
      SELECT c.id, c.name, c.set_name, c.image_small, c.image_large, 'TCG' AS _source
      FROM cards c ${pmJoin} ${tcgWhere}`;

    const pocketSelect = `
      SELECT pc.id, pc.name, ps.name AS set_name,
             pc.image_url AS image_small, pc.image_url AS image_large, 'Pocket' AS _source
      FROM pocket_cards pc
      LEFT JOIN pocket_sets ps ON ps.id = pc.set_id
      ${pocketWhere}`;

    const customSelect = `
      SELECT cc.id, cc.name, cc.set_name, cc.image_small, cc.image_large, cc.source AS _source
      FROM custom_cards cc ${customWhere}`;

    const parts = [tcgSelect];
    if (!pocketExcluded) parts.push(pocketSelect);
    if (!customExcluded) parts.push(customSelect);
    const unionSQL = parts.join(" UNION ALL ");

    const countResult = await conn.query(
      `SELECT COUNT(*)::INTEGER AS cnt FROM (${unionSQL}) combined`
    );
    const total = countResult.toArray()[0].cnt;

    const ALL_ALLOWED_SORT = new Set(["name", "set_name", "id"]);
    const allSortBy = ALL_ALLOWED_SORT.has(sort_by) ? sort_by : "name";
    const dataResult = await conn.query(`
      SELECT id, name, set_name, image_small, image_large, _source
      FROM (${unionSQL}) combined
      ORDER BY ${allSortBy} ${safeSortDir}
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `);

    const cards = dataResult.toArray().map((r) => ({
      id: r.id,
      name: r.name,
      set_name: r.set_name,
      image_small: r.image_small,
      image_large: r.image_large,
      _source: r._source,
      annotations: {},
    }));
    return { cards, total, page: pageInt, page_size: pageSizeInt };
  }

  // ── Pocket source ──────────────────────────────────────────────────
  if (source === "Pocket") {
    const conditions = [];
    if (q) conditions.push(`pc.name ILIKE ${escapeStr("%" + q + "%")}`);
    if (rarity) conditions.push(`pc.rarity = ${escapeStr(rarity)}`);
    if (set_id) conditions.push(`pc.set_id = ${escapeStr(set_id)}`);
    if (card_type) conditions.push(`pc.card_type = ${escapeStr(card_type)}`);
    if (element) conditions.push(`pc.element = ${escapeStr(element)}`);
    if (stage) conditions.push(`pc.stage = ${escapeStr(stage)}`);

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
      const annotations =
        typeof r.annotations === "string"
          ? JSON.parse(r.annotations)
          : r.annotations || {};
      return {
        id: r.id,
        name: r.name,
        supertype: r.supertype,
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

  // ── Custom source (JSON-defined cards) ──────────────────────────────
  if (isCustomSource(source)) {
    const conditions = [];
    conditions.push(`cc.source = ${escapeStr(source)}`);
    if (q) conditions.push(`cc.name ILIKE ${escapeStr("%" + q + "%")}`);
    if (rarity) conditions.push(`cc.rarity = ${escapeStr(rarity)}`);
    if (set_id) conditions.push(`cc.set_id = ${escapeStr(set_id)}`);
    if (supertype) conditions.push(`cc.supertype = ${escapeStr(supertype)}`);
    if (artist) conditions.push(`cc.artist = ${escapeStr(artist)}`);

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const CUSTOM_ALLOWED_SORT = new Set(["name", "hp", "set_name", "rarity", "number", "id"]);
    const safeSortBy = CUSTOM_ALLOWED_SORT.has(sort_by) ? sort_by : "name";
    const sortExpr = safeSortBy === "number"
      ? "TRY_CAST(cc.number AS INTEGER)"
      : `cc.${safeSortBy}`;

    const countResult = await conn.query(
      `SELECT COUNT(*)::INTEGER AS cnt FROM custom_cards cc ${where}`
    );
    const total = countResult.toArray()[0].cnt;

    const dataResult = await conn.query(`
      SELECT cc.*
      FROM custom_cards cc
      ${where}
      ORDER BY ${sortExpr} ${safeSortDir}
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `);

    const rows = dataResult.toArray();
    const cards = rows.map((r) => {
      const annotations =
        typeof r.annotations === "string"
          ? JSON.parse(r.annotations)
          : r.annotations || {};
      // Merge promoted columns into annotations for backward compat
      const promoted = buildPromotedAnnotations(r);
      return {
        id: r.id,
        name: r.name,
        alt_name: r.alt_name || null,
        supertype: r.supertype || "",
        subtypes: r.subtypes || "[]",
        hp: r.hp,
        types: r.types || "[]",
        rarity: r.rarity,
        special_rarity: r.special_rarity || null,
        set_id: r.set_id,
        set_name: r.set_name,
        number: r.number,
        image_small: r.image_small || r.image_large,
        image_large: r.image_large,
        image_fallback: r.image_large || r.image_small || undefined,
        annotations: { ...promoted, ...annotations },
      };
    });

    return { cards, total, page: pageInt, page_size: pageSizeInt };
  }

  // ── TCG source (default) ───────────────────────────────────────────
  const conditions = [];

  if (q) {
    conditions.push(`c.name ILIKE ${escapeStr("%" + q + "%")}`);
  }
  if (supertype) {
    conditions.push(`c.supertype = ${escapeStr(supertype)}`);
  }
  if (rarity) {
    conditions.push(`c.rarity = ${escapeStr(rarity)}`);
  }
  if (set_id) {
    conditions.push(`c.set_id = ${escapeStr(set_id)}`);
  }

  // Artist filter
  if (artist) {
    conditions.push(`c.artist = ${escapeStr(artist)}`);
  }

  // Trainer Type filter (subtypes for Trainer cards)
  if (trainer_type) {
    conditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(trainer_type) + '%')}`);
  }

  // Specialty filter (specific subtypes like Ace Spec, Tool, Technical Machine)
  if (specialty) {
    conditions.push(`c.subtypes ILIKE ${escapeStr('%' + encodeUnicode(specialty) + '%')}`);
  }

  // Pokemon Region annotation filter
  if (region) {
    conditions.push(`c.annotations::JSON->>'pkmn_region' = ${escapeStr(region)}`);
  }
  if (generation) {
    const genInt = parseInt(generation) || 0;
    if (genInt > 0) {
      conditions.push(`pm.generation = ${genInt}`);
    }
  }
  if (color) {
    conditions.push(`pm.color = ${escapeStr(color)}`);
  }
  if (evolution_line) {
    // Filter via pokemon_metadata.evolution_chain (the raw JSON string)
    conditions.push(`pm.evolution_chain = ${escapeStr(evolution_line)}`);
  }

  const where = conditions.length
    ? "WHERE " + conditions.join(" AND ")
    : "";

  // Validate sort
  const safeSortBy = ALLOWED_SORT.has(sort_by) ? sort_by : "name";
  let sortExpr;
  if (safeSortBy === "number") {
    sortExpr = "TRY_CAST(c.number AS INTEGER)";
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
    sortExpr = "c.annotations::JSON->>'pkmn_region'";
  } else {
    sortExpr = `c.${safeSortBy}`;
  }

  // Build JOIN clause for pokemon_metadata
  const joinClause = `
    LEFT JOIN pokemon_metadata pm
      ON pm.pokedex_number = TRY_CAST(
           c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER
         )
  `;

  const countResult = await conn.query(
    `SELECT COUNT(*)::INTEGER AS cnt FROM cards c ${joinClause} ${where}`
  );
  const total = countResult.toArray()[0].cnt;

  const dataResult = await conn.query(`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.rarity,
           c.set_id, c.set_name, c.number, c.image_small, c.image_large,
           c.annotations,
           pm.region, pm.generation, pm.color
    FROM cards c
    ${joinClause}
    ${where}
    ORDER BY ${sortExpr} ${safeSortDir}
    LIMIT ${pageSizeInt} OFFSET ${offset}
  `);

  const rows = dataResult.toArray();
  const cards = rows.map((r) => {
    const annotations =
      typeof r.annotations === "string"
        ? JSON.parse(r.annotations)
        : r.annotations || {};
    return {
      id: r.id,
      name: r.name,
      supertype: r.supertype,
      subtypes: r.subtypes,
      hp: r.hp,
      types: r.types,
      rarity: r.rarity,
      set_id: r.set_id,
      set_name: r.set_name,
      number: r.number,
      image_small: r.image_small,
      image_large: r.image_large,
      annotations,
      region: r.region,
      generation: typeof r.generation === "bigint" ? Number(r.generation) : r.generation,
      color: r.color,
    };
  });

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
    const raw_data =
      typeof r.raw_data === "string" ? JSON.parse(r.raw_data) : r.raw_data || {};
    let annotations =
      typeof r.annotations === "string"
        ? JSON.parse(r.annotations)
        : r.annotations || {};
    const packs =
      typeof r.packs === "string" ? JSON.parse(r.packs) : r.packs || [];

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
      supertype: r.card_type || "",
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

  // ── Custom source (JSON-defined cards) ──────────────────────────────
  if (isCustomSource(source)) {
    const result = await conn.query(`
      SELECT cc.*
      FROM custom_cards cc
      WHERE cc.id = ${escapeStr(id)}
    `);

    const rows = result.toArray();
    if (rows.length === 0) throw new Error("Card not found");

    const r = rows[0];
    let annotations =
      typeof r.annotations === "string"
        ? JSON.parse(r.annotations)
        : r.annotations || {};
    // Merge promoted columns into annotations for backward compat
    const promoted = buildPromotedAnnotations(r);
    annotations = { ...promoted, ...annotations };

    // Auto-populate unique_id if empty
    if (!annotations.unique_id) {
      annotations.unique_id = r.id;
      await conn.query(
        `UPDATE custom_cards SET unique_id = ${escapeStr(r.id)} WHERE id = ${escapeStr(r.id)}`
      );
    }

    return {
      id: r.id,
      name: r.name,
      alt_name: r.alt_name || null,
      supertype: r.supertype || "",
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
      image_fallback: r.image_large || r.image_small || undefined,
      raw_data: {},
      annotations,
      prices: null,
      pokedex_numbers: [],
      genus: null,
    };
  }

  // ── TCG source (default) ───────────────────────────────────────────
  const result = await conn.query(`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.hp, c.types, c.evolves_from,
           c.rarity, c.artist, c.set_id, c.set_name, c.set_series, c.number,
           c.regulation_mark, c.image_small, c.image_large, c.raw_data, c.annotations, c.prices,
           pm.evolution_chain, pm.genus, pm.shape, pm.color AS pm_color, pm.encounter_location
    FROM cards c
    LEFT JOIN pokemon_metadata pm
      ON pm.pokedex_number = TRY_CAST(
           c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER
         )
    WHERE c.id = ${escapeStr(id)}
  `);

  const rows = result.toArray();
  if (rows.length === 0) throw new Error("Card not found");

  const r = rows[0];
  const raw_data =
    typeof r.raw_data === "string" ? JSON.parse(r.raw_data) : r.raw_data;
  let annotations =
    typeof r.annotations === "string"
      ? JSON.parse(r.annotations)
      : r.annotations || {};
  const prices =
    typeof r.prices === "string"
      ? JSON.parse(r.prices)
      : r.prices || {};

  // Auto-populate unique_id if empty
  let needsPatch = false;
  if (!annotations.unique_id) {
    annotations.unique_id = r.id;
    needsPatch = true;
  }

  // Auto-populate evolution_line if empty and we have evolution_chain data
  if (!annotations.evolution_line && r.evolution_chain) {
    try {
      const chain = typeof r.evolution_chain === "string"
        ? JSON.parse(r.evolution_chain)
        : r.evolution_chain;
      if (Array.isArray(chain) && chain.length > 0) {
        annotations.evolution_line = chain.join(" → ");
        needsPatch = true;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Auto-populate color from PokeAPI if not set
  if (!annotations.color && r.pm_color) {
    annotations.color = r.pm_color;
    needsPatch = true;
  }

  // Auto-populate shape from PokeAPI if not set
  if (!annotations.shape && r.shape) {
    annotations.shape = r.shape;
    needsPatch = true;
  }

  // Auto-populate location from PokeAPI encounter_location if not set
  if (!annotations.location && r.encounter_location) {
    annotations.location = r.encounter_location;
    needsPatch = true;
  }

  // Persist auto-populated values to IndexedDB
  if (needsPatch) {
    const patchData = {};
    if (annotations.unique_id) patchData.unique_id = annotations.unique_id;
    if (annotations.evolution_line) patchData.evolution_line = annotations.evolution_line;
    if (annotations.color) patchData.color = annotations.color;
    if (annotations.shape) patchData.shape = annotations.shape;
    if (annotations.location) patchData.location = annotations.location;
    await patchAnnotations(r.id, patchData);
  }

  // Extract pokedex numbers from raw_data
  const pokedex_numbers = raw_data?.nationalPokedexNumbers || [];

  return {
    id: r.id,
    name: r.name,
    supertype: r.supertype,
    subtypes: r.subtypes,
    hp: r.hp,
    types: r.types,
    evolves_from: r.evolves_from,
    rarity: r.rarity,
    artist: r.artist,
    set_id: r.set_id,
    set_name: r.set_name,
    set_series: r.set_series,
    number: r.number,
    regulation_mark: r.regulation_mark,
    image_small: r.image_small,
    image_large: r.image_large,
    raw_data,
    annotations,
    prices,
    pokedex_numbers,
    genus: r.genus || null,
  };
}

/**
 * Fetch distinct values for all filter dropdowns.
 */
export async function fetchFilterOptions(source = "TCG") {
  // ── All sources ────────────────────────────────────────────────────
  if (source === "") {
    const [stResult, raritiesResult, setsResult, regionsResult, generationsResult, colorsResult, artistsResult, evolutionLinesResult, trainerTypesResult, specialtiesResult] =
      await Promise.all([
        conn.query(
          "SELECT DISTINCT supertype FROM cards WHERE supertype != '' ORDER BY supertype"
        ),
        conn.query(
          "SELECT DISTINCT rarity FROM cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY rarity"
        ),
        conn.query(
          "SELECT id, name, series FROM sets ORDER BY series, release_date"
        ),
        conn.query(`
          SELECT DISTINCT val FROM (
            SELECT pkmn_region AS val FROM custom_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
            UNION
            SELECT annotations::JSON->>'pkmn_region' AS val FROM cards WHERE annotations IS NOT NULL AND annotations::JSON->>'pkmn_region' IS NOT NULL AND annotations::JSON->>'pkmn_region' != ''
            UNION
            SELECT annotations::JSON->>'pkmn_region' AS val FROM pocket_cards WHERE annotations IS NOT NULL AND annotations::JSON->>'pkmn_region' IS NOT NULL AND annotations::JSON->>'pkmn_region' != ''
          ) WHERE val IS NOT NULL ORDER BY val
        `),
        conn.query(
          "SELECT DISTINCT generation FROM pokemon_metadata WHERE generation IS NOT NULL ORDER BY generation"
        ),
        conn.query(
          "SELECT DISTINCT color FROM pokemon_metadata WHERE color IS NOT NULL ORDER BY color"
        ),
        conn.query(
          "SELECT DISTINCT artist FROM cards WHERE artist IS NOT NULL AND artist != '' ORDER BY artist"
        ),
        conn.query(
          "SELECT DISTINCT evolution_chain FROM pokemon_metadata WHERE evolution_chain IS NOT NULL ORDER BY evolution_chain"
        ),
        conn.query(`
          SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
            REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
          )))) AS trainer_type
          FROM cards
          WHERE supertype = 'Trainer' AND subtypes != '[]' AND subtypes != ''
          ORDER BY trainer_type
        `),
        conn.query(`
          SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
            REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
          )))) AS specialty
          FROM cards
          WHERE subtypes ILIKE '%Ace Spec%'
             OR subtypes ILIKE '%Tool%'
             OR subtypes ILIKE '%Technical%'
          ORDER BY specialty
        `),
      ]);

    const supertypes = stResult.toArray().map((r) => r.supertype);
    const rarities = raritiesResult.toArray().map((r) => r.rarity);
    const sets = setsResult.toArray().map((r) => ({ id: r.id, name: r.name, series: r.series }));
    const dbRegions = regionsResult.toArray().map((r) => r.val).filter(Boolean);
    const regions = [...new Set([...PKMN_REGION_OPTIONS, ...dbRegions])].sort();
    const generations = generationsResult.toArray().map((r) =>
      typeof r.generation === "bigint" ? Number(r.generation) : r.generation
    );
    const colors = colorsResult.toArray().map((r) => r.color);
    const artists = artistsResult.toArray().map((r) => r.artist);
    const evolution_lines = evolutionLinesResult.toArray().map((r) => r.evolution_chain);
    const decodeUnicode = (str) => {
      try { return JSON.parse(`"${str}"`); } catch { return str; }
    };
    const trainer_types = trainerTypesResult.toArray().map((r) => decodeUnicode(r.trainer_type)).filter(t => t);
    const specialties = specialtiesResult.toArray().map((r) => decodeUnicode(r.specialty)).filter(s => s);

    return {
      supertypes, rarities, sets, regions, generations, colors, artists, evolution_lines, trainer_types, specialties,
      card_types: [], elements: [], stages: [],
    };
  }

  // ── Pocket source ──────────────────────────────────────────────────
  if (source === "Pocket") {
    const [cardTypesResult, raritiesResult, setsResult, elementsResult, stagesResult] =
      await Promise.all([
        conn.query(
          "SELECT DISTINCT card_type FROM pocket_cards WHERE card_type IS NOT NULL AND card_type != '' ORDER BY card_type"
        ),
        conn.query(
          "SELECT DISTINCT rarity FROM pocket_cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY rarity"
        ),
        conn.query(
          "SELECT id, name, series FROM pocket_sets ORDER BY series, release_date"
        ),
        conn.query(
          "SELECT DISTINCT element FROM pocket_cards WHERE element IS NOT NULL AND element != '' ORDER BY element"
        ),
        conn.query(
          "SELECT DISTINCT stage FROM pocket_cards WHERE stage IS NOT NULL AND stage != '' ORDER BY stage"
        ),
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
      // Pocket-specific
      card_types: cardTypesResult.toArray().map((r) => r.card_type),
      elements: elementsResult.toArray().map((r) => r.element),
      stages: stagesResult.toArray().map((r) => r.stage),
    };
  }

  // ── Custom source (JSON-defined cards) ──────────────────────────────
  if (isCustomSource(source)) {
    const srcFilter = `source = ${escapeStr(source)}`;

    const [supertypesResult, raritiesResult, setsResult, artistsResult] =
      await Promise.all([
        conn.query(
          `SELECT DISTINCT supertype FROM custom_cards WHERE ${srcFilter} AND supertype IS NOT NULL AND supertype != '' ORDER BY supertype`
        ),
        conn.query(
          `SELECT DISTINCT rarity FROM custom_cards WHERE ${srcFilter} AND rarity IS NOT NULL AND rarity != '' ORDER BY rarity`
        ),
        conn.query(
          `SELECT DISTINCT set_id AS id, set_name AS name, set_series AS series FROM custom_cards WHERE ${srcFilter} AND set_id IS NOT NULL AND set_id != '' ORDER BY set_series, set_name`
        ),
        conn.query(
          `SELECT DISTINCT artist FROM custom_cards WHERE ${srcFilter} AND artist IS NOT NULL AND artist != '' ORDER BY artist`
        ),
      ]);

    return {
      supertypes: supertypesResult.toArray().map((r) => r.supertype),
      rarities: raritiesResult.toArray().map((r) => r.rarity),
      sets: setsResult.toArray().map((r) => ({ id: r.id, name: r.name, series: r.series })),
      regions: [],
      generations: [],
      colors: [],
      artists: artistsResult.toArray().map((r) => r.artist),
      evolution_lines: [],
      trainer_types: [],
      specialties: [],
      card_types: [],
      elements: [],
      stages: [],
    };
  }

  // ── TCG source (default) ───────────────────────────────────────────
  const [stResult, raritiesResult, setsResult, regionsResult, generationsResult, colorsResult, artistsResult, evolutionLinesResult, trainerTypesResult, specialtiesResult] =
    await Promise.all([
      conn.query(
        "SELECT DISTINCT supertype FROM cards WHERE supertype != '' ORDER BY supertype"
      ),
      conn.query(
        "SELECT DISTINCT rarity FROM cards WHERE rarity IS NOT NULL AND rarity != '' ORDER BY rarity"
      ),
      conn.query(
        "SELECT id, name, series FROM sets ORDER BY series, release_date"
      ),
      conn.query(`
        SELECT DISTINCT val FROM (
          SELECT pkmn_region AS val FROM custom_cards WHERE pkmn_region IS NOT NULL AND pkmn_region != ''
          UNION
          SELECT annotations::JSON->>'pkmn_region' AS val FROM cards WHERE annotations IS NOT NULL AND annotations::JSON->>'pkmn_region' IS NOT NULL AND annotations::JSON->>'pkmn_region' != ''
          UNION
          SELECT annotations::JSON->>'pkmn_region' AS val FROM pocket_cards WHERE annotations IS NOT NULL AND annotations::JSON->>'pkmn_region' IS NOT NULL AND annotations::JSON->>'pkmn_region' != ''
        ) WHERE val IS NOT NULL ORDER BY val
      `),
      conn.query(
        "SELECT DISTINCT generation FROM pokemon_metadata WHERE generation IS NOT NULL ORDER BY generation"
      ),
      conn.query(
        "SELECT DISTINCT color FROM pokemon_metadata WHERE color IS NOT NULL ORDER BY color"
      ),
      conn.query(
        "SELECT DISTINCT artist FROM cards WHERE artist IS NOT NULL AND artist != '' ORDER BY artist"
      ),
      conn.query(
        "SELECT DISTINCT evolution_chain FROM pokemon_metadata WHERE evolution_chain IS NOT NULL ORDER BY evolution_chain"
      ),
      // Trainer Type: subtypes for Trainer cards (Item, Supporter, Stadium, Tool, etc.)
      conn.query(`
        SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
          REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
        )))) AS trainer_type
        FROM cards
        WHERE supertype = 'Trainer' AND subtypes != '[]' AND subtypes != ''
        ORDER BY trainer_type
      `),
      // Specialty: specific subtypes like Ace Spec, Pokémon Tool, Technical Machine
      conn.query(`
        SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
          REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
        )))) AS specialty
        FROM cards
        WHERE subtypes ILIKE '%Ace Spec%'
           OR subtypes ILIKE '%Tool%'
           OR subtypes ILIKE '%Technical%'
        ORDER BY specialty
      `),
    ]);

  const supertypes = stResult.toArray().map((r) => r.supertype);
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
  const evolution_lines = evolutionLinesResult.toArray().map((r) => r.evolution_chain);
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

  return {
    supertypes, rarities, sets, regions, generations, colors, artists, evolution_lines, trainer_types, specialties,
    // Empty Pocket-only fields
    card_types: [], elements: [], stages: [],
  };
}

// ── Form Options (for custom card form comboboxes) ─────────────────────

/**
 * Fetch distinct values for custom card form comboboxes.
 * Queries cards, custom_cards, pokemon_metadata, and sets tables.
 */
export async function fetchFormOptions() {
  const queries = await Promise.all([
    // rarity: from cards + custom_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT rarity AS val FROM cards WHERE rarity IS NOT NULL AND rarity != ''
        UNION SELECT rarity AS val FROM custom_cards WHERE rarity IS NOT NULL AND rarity != ''
      ) ORDER BY val`
    ),
    // artist: from cards + custom_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT artist AS val FROM cards WHERE artist IS NOT NULL AND artist != ''
        UNION SELECT artist AS val FROM custom_cards WHERE artist IS NOT NULL AND artist != ''
      ) ORDER BY val`
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
      )))) AS val FROM cards WHERE types != '[]' AND types != '' ORDER BY val`
    ),
    // subtypes: from cards (unnest JSON array)
    conn.query(
      `SELECT DISTINCT TRIM(BOTH '"' FROM TRIM(unnest(string_split(
        REPLACE(REPLACE(subtypes, '[', ''), ']', ''), ','
      )))) AS val FROM cards WHERE subtypes != '[]' AND subtypes != '' ORDER BY val`
    ),
    // emotion: from custom_cards
    conn.query(
      `SELECT DISTINCT emotion AS val FROM custom_cards WHERE emotion IS NOT NULL AND emotion != '' ORDER BY val`
    ),
    // pose: from custom_cards
    conn.query(
      `SELECT DISTINCT pose AS val FROM custom_cards WHERE pose IS NOT NULL AND pose != '' ORDER BY val`
    ),
    // cameraAngle: from custom_cards
    conn.query(
      `SELECT DISTINCT camera_angle AS val FROM custom_cards WHERE camera_angle IS NOT NULL AND camera_angle != '' ORDER BY val`
    ),
    // perspective: from custom_cards
    conn.query(
      `SELECT DISTINCT perspective AS val FROM custom_cards WHERE perspective IS NOT NULL AND perspective != '' ORDER BY val`
    ),
    // weather: from custom_cards
    conn.query(
      `SELECT DISTINCT weather AS val FROM custom_cards WHERE weather IS NOT NULL AND weather != '' ORDER BY val`
    ),
    // environment: from custom_cards
    conn.query(
      `SELECT DISTINCT environment AS val FROM custom_cards WHERE environment IS NOT NULL AND environment != '' ORDER BY val`
    ),
    // storytelling: from custom_cards
    conn.query(
      `SELECT DISTINCT storytelling AS val FROM custom_cards WHERE storytelling IS NOT NULL AND storytelling != '' ORDER BY val`
    ),
    // cardLocations: from custom_cards
    conn.query(
      `SELECT DISTINCT card_locations AS val FROM custom_cards WHERE card_locations IS NOT NULL AND card_locations != '' ORDER BY val`
    ),
    // items: from custom_cards
    conn.query(
      `SELECT DISTINCT items AS val FROM custom_cards WHERE items IS NOT NULL AND items != '' ORDER BY val`
    ),
    // actions: from custom_cards
    conn.query(
      `SELECT DISTINCT actions AS val FROM custom_cards WHERE actions IS NOT NULL AND actions != '' ORDER BY val`
    ),
    // videoTitle: from custom_cards
    conn.query(
      `SELECT DISTINCT video_title AS val FROM custom_cards WHERE video_title IS NOT NULL AND video_title != '' ORDER BY val`
    ),
    // setId: from sets + custom_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT id AS val FROM sets WHERE id IS NOT NULL AND id != ''
        UNION SELECT set_id AS val FROM custom_cards WHERE set_id IS NOT NULL AND set_id != ''
      ) ORDER BY val`
    ),
    // setName: from sets + custom_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT name AS val FROM sets WHERE name IS NOT NULL AND name != ''
        UNION SELECT set_name AS val FROM custom_cards WHERE set_name IS NOT NULL AND set_name != ''
      ) ORDER BY val`
    ),
    // name: from cards + custom_cards
    conn.query(
      `SELECT DISTINCT val FROM (
        SELECT name AS val FROM cards WHERE name IS NOT NULL AND name != ''
        UNION SELECT name AS val FROM custom_cards WHERE name IS NOT NULL AND name != ''
      ) ORDER BY val`
    ),
    // source: from custom_cards
    conn.query(
      `SELECT DISTINCT source AS val FROM custom_cards WHERE source IS NOT NULL AND source != '' ORDER BY val`
    ),
    // heldItem: from custom_cards
    conn.query(
      `SELECT DISTINCT held_item AS val FROM custom_cards WHERE held_item IS NOT NULL AND held_item != '' ORDER BY val`
    ),
    // pokeball: from custom_cards
    conn.query(
      `SELECT DISTINCT pokeball AS val FROM custom_cards WHERE pokeball IS NOT NULL AND pokeball != '' ORDER BY val`
    ),
    // trainerCardType: from custom_cards
    conn.query(
      `SELECT DISTINCT trainer_card_type AS val FROM custom_cards WHERE trainer_card_type IS NOT NULL AND trainer_card_type != '' ORDER BY val`
    ),
    // stamp: from custom_cards
    conn.query(
      `SELECT DISTINCT stamp AS val FROM custom_cards WHERE stamp IS NOT NULL AND stamp != '' ORDER BY val`
    ),
  ]);

  const toArr = (result) => result.toArray().map((r) => r.val).filter(Boolean);

  // For multi-value fields stored as JSON arrays or comma-separated, we need to split them
  const splitJsonArrayValues = async (column, table = "custom_cards") => {
    const result = await conn.query(
      `SELECT DISTINCT TRIM(val) AS val FROM (
        SELECT unnest(string_split(
          REPLACE(REPLACE(${column}, '["', ''), '"]', ''),
          '","'
        )) AS val FROM ${table}
        WHERE ${column} IS NOT NULL AND ${column} != '' AND ${column} != '[]'
      ) WHERE TRIM(val) != '' ORDER BY val`
    );
    return result.toArray().map((r) => r.val).filter(Boolean);
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
    // background_humans: from custom cards + static trainer list
    (async () => {
      const fromCustom = await splitJsonArrayValues("background_humans");
      return [...new Set([...BACKGROUND_HUMANS_OPTIONS, ...fromCustom])];
    })(),
    splitJsonArrayValues("additional_characters"),
    splitJsonArrayValues("background_details"),
    // evolution_line: full chains from custom_cards + pokemon_metadata.evolution_chain
    (async () => {
      const [customResult, pmResult] = await Promise.all([
        conn.query(
          `SELECT DISTINCT TRIM(evolution_line) AS val
           FROM custom_cards WHERE evolution_line IS NOT NULL AND evolution_line != ''
           ORDER BY val`
        ),
        conn.query(
          `SELECT DISTINCT REPLACE(REPLACE(REPLACE(REPLACE(evolution_chain, '[', ''), ']', ''), '"', ''), ',', ' → ') AS val
           FROM pokemon_metadata WHERE evolution_chain IS NOT NULL AND evolution_chain != '' AND evolution_chain != '[]'
           ORDER BY val`
        ),
      ]);
      const fromCustom = customResult.toArray().map((r) => r.val?.toLowerCase()).filter(Boolean);
      const fromPm = pmResult.toArray().map((r) => r.val).filter(Boolean);
      return [...new Set([...fromPm, ...fromCustom])].sort();
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
  };
}

// ── Annotations ────────────────────────────────────────────────────────

/**
 * Get annotations for a card.
 */
export async function fetchAnnotations(cardId) {
  let result = await conn.query(
    `SELECT annotations FROM cards WHERE id = ${escapeStr(cardId)}`
  );
  let rows = result.toArray();
  if (rows.length === 0) {
    result = await conn.query(
      `SELECT annotations FROM pocket_cards WHERE id = ${escapeStr(cardId)}`
    );
    rows = result.toArray();
  }
  if (rows.length === 0) {
    result = await conn.query(
      `SELECT annotations FROM custom_cards WHERE id = ${escapeStr(cardId)}`
    );
    rows = result.toArray();
  }
  if (rows.length === 0) throw new Error("Card not found");

  const val = rows[0].annotations;
  return typeof val === "string" ? JSON.parse(val) : val || {};
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

  // Write to DuckDB (all card tables — only one will match)
  const escaped = escapeStr(JSON.stringify(current));
  const escapedId = escapeStr(cardId);
  await conn.query(
    `UPDATE cards SET annotations = ${escaped} WHERE id = ${escapedId}`
  );
  await conn.query(
    `UPDATE pocket_cards SET annotations = ${escaped} WHERE id = ${escapedId}`
  );

  // For custom_cards, also update promoted columns
  const promotedColumnUpdates = [];
  const allPromoted = new Set([...PROMOTED_ARRAY_FIELDS, ...PROMOTED_STRING_FIELDS, ...PROMOTED_BOOL_FIELDS]);
  for (const [key, value] of Object.entries(annotations)) {
    if (!allPromoted.has(key)) continue;
    if (PROMOTED_BOOL_FIELDS.includes(key)) {
      promotedColumnUpdates.push(`${key} = ${value === true}`);
    } else {
      promotedColumnUpdates.push(`${key} = ${escapeStr(typeof value === 'object' ? JSON.stringify(value) : String(value || ''))}`);
    }
  }
  const extraSet = promotedColumnUpdates.length > 0 ? ', ' + promotedColumnUpdates.join(', ') : '';
  await conn.query(
    `UPDATE custom_cards SET annotations = ${escaped}${extraSet} WHERE id = ${escapedId}`
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
    options:
      typeof r.options === "string" && r.options !== "null"
        ? JSON.parse(r.options)
        : null,
    default_value:
      typeof r.default_value === "string" && r.default_value !== "null"
        ? JSON.parse(r.default_value)
        : null,
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
      ${escapeStr(JSON.stringify(options))},
      ${escapeStr(JSON.stringify(default_value))},
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
    if (/\bcards\b/i.test(trimmed) && !/\bpocket_cards\b/i.test(trimmed) && !/\bcustom_cards\b/i.test(trimmed)) {
      annotationTables.push("cards");
    }
    if (/\bpocket_cards\b/i.test(trimmed)) {
      annotationTables.push("pocket_cards");
    }
    if (/\bcustom_cards\b/i.test(trimmed)) {
      annotationTables.push("custom_cards");
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
    conn.query("SELECT id, annotations FROM cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM pocket_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM custom_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
  ]);
  for (const result of queries) {
    for (const row of result.toArray()) {
      const data = typeof row.annotations === "string" ? JSON.parse(row.annotations) : row.annotations || {};
      if (Object.keys(data).length > 0) results[row.id] = data;
    }
  }
  return results;
}

/**
 * Sync the mutable DuckDB tables (annotations + custom_cards) back to
 * IndexedDB. Call this after SQL console mutations to persist changes.
 * Returns { annotationsSynced, customCardsSynced, customCardsData } where
 * customCardsData is the { cards: [...] } payload ready for GitHub.
 */
export async function syncMutableTablesToIndexedDB() {
  const results = { annotationsSynced: 0, customCardsSynced: 0, customCardsData: null };

  // 1. Upsert all non-empty annotations from every card table
  const annQueries = await Promise.all([
    conn.query("SELECT id, annotations FROM cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM pocket_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
    conn.query("SELECT id, annotations FROM custom_cards WHERE annotations IS NOT NULL AND annotations != '{}'"),
  ]);

  for (const result of annQueries) {
    for (const row of result.toArray()) {
      const data =
        typeof row.annotations === "string"
          ? JSON.parse(row.annotations)
          : row.annotations || {};
      if (Object.keys(data).length > 0) {
        await idbPut(STORE_ANNOTATIONS, { id: row.id, data });
        results.annotationsSynced++;
      }
    }
  }

  // 2. Full sync of custom_cards — clear store and repopulate from DuckDB
  await idbClearStore(STORE_CUSTOM_CARDS);

  const customCardsResult = await conn.query("SELECT * FROM custom_cards");
  const rows = customCardsResult.toArray();
  const cardsForJson = [];

  const parseArr = (val) => {
    if (!val || val === "[]") return [];
    try { return JSON.parse(val); } catch { return val ? [val] : []; }
  };

  for (const row of rows) {
    const card = {
      id: row.id || "",
      name: row.name || "",
      supertype: row.supertype || "",
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
      source: row.source || "",
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
      items: row.items || "",
      actions: row.actions || "",
      perspective: row.perspective || "",
      weather_environment: row.weather_environment || "",
      weather: row.weather || "",
      environment: row.environment || "",
      storytelling: row.storytelling || "",
      card_locations: row.card_locations || "",
      pkmn_region: row.pkmn_region || "",
      card_region: row.card_region || "",
      primary_color: row.primary_color || "",
      secondary_color: row.secondary_color || "",
      shape: row.shape || "",
      video_game: row.video_game || "",
      video_appearance: row.video_appearance === true,
      thumbnail_used: row.thumbnail_used === true,
      video_url: row.video_url || "",
      video_title: row.video_title || "",
      unique_id: row.unique_id || "",
      owned: row.owned === true,
      notes: row.notes || "",
      card_subcategory:      parseArr(row.card_subcategory),
      held_item:             row.held_item || "",
      pokeball:              row.pokeball || "",
      evolution_items:       parseArr(row.evolution_items),
      berries:               parseArr(row.berries),
      holiday_theme:         parseArr(row.holiday_theme),
      multi_card:            parseArr(row.multi_card),
      trainer_card_type:     row.trainer_card_type || "",
      trainer_card_subgroup: parseArr(row.trainer_card_subgroup),
      video_type:     parseArr(row.video_type),
      video_region:   parseArr(row.video_region),
      video_location: parseArr(row.video_location),
      annotations:
        typeof row.annotations === "string"
          ? JSON.parse(row.annotations)
          : row.annotations || {},
    };
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

/**
 * Add a custom card to the database.
 * Accepts all custom_cards columns. Inserts into custom_cards table.
 */
export async function addCustomCard(card) {
  if (!card.id) {
    throw new Error("Card must have an id");
  }

  // Check if card already exists
  const existing = await conn.query(
    `SELECT id FROM custom_cards WHERE id = ${escapeStr(card.id)}`
  );
  if (existing.numRows > 0) {
    throw new Error(`Card with ID '${card.id}' already exists`);
  }

  const s = (key) => escapeStr(card[key] || '');
  const b = (key) => card[key] === true;

  // Ensure subtypes and types are JSON array strings
  const subtypesStr = Array.isArray(card.subtypes) ? JSON.stringify(card.subtypes) : (card.subtypes || '[]');
  const typesStr = Array.isArray(card.types) ? JSON.stringify(card.types) : (card.types || '[]');

  // Insert into DuckDB custom_cards table
  await conn.query(`
    INSERT INTO custom_cards (
      id, name, supertype, subtypes, hp, types, evolves_from,
      rarity, special_rarity, alt_name, artist, set_id, set_name, set_series, number,
      regulation_mark, image_small, image_large, source,
      art_style, main_character, background_pokemon, background_humans,
      additional_characters, evolution_line, background_details,
      emotion, pose, camera_angle, items, actions, perspective,
      weather_environment, weather, environment, storytelling, card_locations, pkmn_region, card_region,
      primary_color, secondary_color, shape,
      video_game, video_appearance, thumbnail_used, video_url, video_title,
      unique_id, owned, notes,
      card_subcategory, held_item, pokeball, evolution_items, berries,
      holiday_theme, multi_card, trainer_card_type, trainer_card_subgroup,
      video_type, video_region, video_location,
      pocket_exclusive, stamp,
      annotations
    ) VALUES (
      ${escapeStr(card.id)}, ${escapeStr(card.name || '')}, ${escapeStr(card.supertype || '')},
      ${escapeStr(subtypesStr)}, ${escapeStr(card.hp != null ? String(card.hp) : '')}, ${escapeStr(typesStr)},
      ${s('evolves_from')}, ${s('rarity')}, ${s('special_rarity')}, ${s('alt_name')}, ${s('artist')},
      ${s('set_id')}, ${s('set_name')}, ${s('set_series')}, ${s('number')},
      ${s('regulation_mark')}, ${s('image_small')}, ${s('image_large')}, ${s('source')},
      ${s('art_style')}, ${s('main_character')}, ${s('background_pokemon')}, ${s('background_humans')},
      ${s('additional_characters')}, ${s('evolution_line')}, ${s('background_details')},
      ${s('emotion')}, ${s('pose')}, ${s('camera_angle')}, ${s('items')}, ${s('actions')}, ${s('perspective')},
      ${s('weather_environment')}, ${s('weather')}, ${s('environment')}, ${s('storytelling')}, ${s('card_locations')}, ${s('pkmn_region')}, ${s('card_region')},
      ${s('primary_color')}, ${s('secondary_color')}, ${s('shape')},
      ${s('video_game')}, ${b('video_appearance')}, ${b('thumbnail_used')}, ${s('video_url')}, ${s('video_title')},
      ${s('unique_id')}, ${b('owned')}, ${s('notes')},
      ${s('card_subcategory')}, ${s('held_item')}, ${s('pokeball')}, ${s('evolution_items')},
      ${s('berries')}, ${s('holiday_theme')}, ${s('multi_card')}, ${s('trainer_card_type')},
      ${s('trainer_card_subgroup')},
      ${s('video_type')}, ${s('video_region')}, ${s('video_location')},
      ${b('pocket_exclusive')}, ${s('stamp')},
      ${escapeStr(JSON.stringify({}))}
    )
  `);

  // Register the source name if new
  if (card.source) {
    customSourceNames.add(card.source);
  }

  // Write-through to IndexedDB for persistence
  await idbPut(STORE_CUSTOM_CARDS, card);

  return card;
}

/**
 * Delete a custom card.
 */
export async function deleteCustomCard(cardId) {
  const result = await conn.query(
    `SELECT id FROM custom_cards WHERE id = ${escapeStr(cardId)}`
  );
  if (result.toArray().length === 0) {
    throw new Error(`Card '${cardId}' not found in custom_cards`);
  }

  await conn.query(`DELETE FROM custom_cards WHERE id = ${escapeStr(cardId)}`);
  await idbDelete(STORE_CUSTOM_CARDS, cardId);
  await idbDelete(STORE_ANNOTATIONS, cardId);
}

/**
 * Fetch all custom cards.
 */
export async function fetchCustomCards() {
  const result = await conn.query(`
    SELECT id, name, supertype, hp, types, rarity, set_id, set_name, number, image_small, source
    FROM custom_cards
    ORDER BY source, set_id, name
  `);

  return result.toArray().map((r) => ({
    id: r.id,
    name: r.name,
    supertype: r.supertype,
    hp: r.hp,
    types: r.types,
    rarity: r.rarity,
    set_id: r.set_id,
    set_name: r.set_name,
    number: r.number,
    image_small: r.image_small,
    source: r.source,
  }));
}
