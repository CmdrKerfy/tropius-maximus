/**
 * db.js — DuckDB-WASM + IndexedDB database layer.
 *
 * Exports the exact same function signatures as the original api.js
 * so all React components work unchanged. Data comes from static
 * Parquet files loaded into an in-memory DuckDB-WASM instance.
 * User annotations and custom attributes persist in IndexedDB.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

// ── Module-level state ─────────────────────────────────────────────────

let db = null;
let conn = null;
let initialized = false;

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

// ── SQL escape helpers ─────────────────────────────────────────────────

function escapeStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// ── Initialization ─────────────────────────────────────────────────────

/**
 * Initialize DuckDB-WASM, load Parquet data, create annotation/attribute
 * tables, and hydrate user data from IndexedDB.
 */
export async function initDB() {
  if (initialized) return;

  // 1. Load DuckDB-WASM bundles from jsDelivr CDN
  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {
      type: "text/javascript",
    })
  );

  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(worker_url);

  conn = await db.connect();

  // 2. Fetch Parquet files and register them
  const base = import.meta.env.BASE_URL || "/";
  const [cardsResp, setsResp, pokemonMetaResp] = await Promise.all([
    fetch(`${base}data/cards.parquet`),
    fetch(`${base}data/sets.parquet`),
    fetch(`${base}data/pokemon_metadata.parquet`),
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
      ('pokemon_main',     'Pokemon [Main]',     'text',    'null', '""',      TRUE, 2),
      ('pokemon_bg',       'Pokemon [Background]', 'text',  'null', '""',      TRUE, 3),
      ('color',            'Color',              'select',  '["black","blue","brown","gray","green","pink","purple","red","white","yellow"]', 'null', TRUE, 5),
      ('shape',            'Shape',              'select',  ${escapeStr(shapeOptions)}, 'null', TRUE, 6),
      ('location',         'Location',           'text',    'null', '""',      TRUE, 10),
      ('video_game',       'Video Game',         'select',  ${escapeStr(videoGameOptions)}, 'null', TRUE, 11),
      ('video_appearance', 'Video Appearance',   'boolean', 'null', 'false',   TRUE, 12),
      ('thumbnail_used',   'Thumbnail Used',     'boolean', 'null', 'false',   TRUE, 13),
      ('video_url',        'Video URL',          'text',    'null', '""',      TRUE, 14),
      ('video_title',      'Video Title',        'text',    'null', '""',      TRUE, 15),
      ('unique_id',        'Unique ID',          'text',    'null', '""',      TRUE, 16),
      ('evolution_line',   'Evolution Line',     'text',    'null', '""',      TRUE, 20)
  `);

  // 6. Hydrate from IndexedDB
  await hydrateFromIndexedDB();

  initialized = true;
}

async function hydrateFromIndexedDB() {
  // Hydrate annotations
  const annotations = await idbGetAll(STORE_ANNOTATIONS);
  for (const row of annotations) {
    await conn.query(
      `UPDATE cards SET annotations = ${escapeStr(JSON.stringify(row.data))} WHERE id = ${escapeStr(row.id)}`
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

  // Hydrate custom cards
  const customCards = await idbGetAll(STORE_CUSTOM_CARDS);
  for (const card of customCards) {
    const existing = await conn.query(
      `SELECT id FROM cards WHERE id = ${escapeStr(card.id)}`
    );
    if (existing.numRows === 0) {
      await conn.query(`
        INSERT INTO cards (
          id, name, supertype, subtypes, hp, types, rarity, artist,
          set_id, set_name, number, image_small, image_large, raw_data, annotations
        ) VALUES (
          ${escapeStr(card.id)},
          ${escapeStr(card.name)},
          ${escapeStr(card.supertype || "")},
          ${escapeStr(card.subtypes || "[]")},
          ${escapeStr(card.hp || "")},
          ${escapeStr(card.types || "[]")},
          ${escapeStr(card.rarity || "")},
          ${escapeStr(card.artist || "")},
          ${escapeStr(card.set_id)},
          ${escapeStr(card.set_name || "")},
          ${escapeStr(card.number || "")},
          ${escapeStr(card.image_small || "")},
          ${escapeStr(card.image_large || card.image_small || "")},
          ${escapeStr(JSON.stringify(card.raw_data || {}))},
          ${escapeStr(JSON.stringify(card.annotations || {}))}
        )
      `);
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
    sort_by = "name",
    sort_dir = "asc",
    page = 1,
    page_size = 40,
  } = params;

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

  // Pokemon metadata filters (using JOIN)
  if (region) {
    conditions.push(`pm.region = ${escapeStr(region)}`);
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
  const safeSortDir = sort_dir === "desc" ? "DESC" : "ASC";
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
    sortExpr = "pm.region";
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

  const pageInt = parseInt(page) || 1;
  const pageSizeInt = parseInt(page_size) || 40;
  const offset = (pageInt - 1) * pageSizeInt;

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
export async function fetchCard(id) {
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
export async function fetchFilterOptions() {
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
      conn.query(
        "SELECT DISTINCT region FROM pokemon_metadata WHERE region IS NOT NULL ORDER BY region"
      ),
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
  const regions = regionsResult.toArray().map((r) => r.region);
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

  return { supertypes, rarities, sets, regions, generations, colors, artists, evolution_lines, trainer_types, specialties };
}

// ── Annotations ────────────────────────────────────────────────────────

/**
 * Get annotations for a card.
 */
export async function fetchAnnotations(cardId) {
  const result = await conn.query(
    `SELECT annotations FROM cards WHERE id = ${escapeStr(cardId)}`
  );
  const rows = result.toArray();
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

  // Write to DuckDB
  await conn.query(
    `UPDATE cards SET annotations = ${escapeStr(JSON.stringify(current))} WHERE id = ${escapeStr(cardId)}`
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
  return {
    columns: [],
    rows: [],
    row_count: 0,
    message: "Query executed successfully",
  };
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
 * Custom cards must have a set_id that starts with "custom-".
 */
export async function addCustomCard(card) {
  if (!card.set_id.startsWith("custom-")) {
    throw new Error("Custom card set_id must start with 'custom-'");
  }

  // Build full card ID
  const fullId = `${card.set_id}-${card.card_id}`;

  // Check if card already exists
  const existing = await conn.query(
    `SELECT id FROM cards WHERE id = ${escapeStr(fullId)}`
  );
  if (existing.numRows > 0) {
    throw new Error(`Card with ID '${fullId}' already exists`);
  }

  // Ensure the set exists
  await addCustomSet({
    id: card.set_id,
    name: card.set_name || card.set_id.replace("custom-", "").replace(/-/g, " "),
  });

  const cardData = {
    id: fullId,
    name: card.name,
    supertype: card.supertype || "",
    subtypes: card.subtypes || "[]",
    hp: card.hp || "",
    types: card.types ? JSON.stringify([card.types]) : "[]",
    rarity: card.rarity || "",
    artist: card.artist || "",
    set_id: card.set_id,
    set_name: card.set_name || card.set_id.replace("custom-", "").replace(/-/g, " "),
    number: card.number || "",
    image_small: card.image_url || "",
    image_large: card.image_url || "",
    raw_data: {},
    annotations: {},
  };

  // Insert into DuckDB
  await conn.query(`
    INSERT INTO cards (
      id, name, supertype, subtypes, hp, types, rarity, artist,
      set_id, set_name, number, image_small, image_large, raw_data, annotations
    ) VALUES (
      ${escapeStr(cardData.id)},
      ${escapeStr(cardData.name)},
      ${escapeStr(cardData.supertype)},
      ${escapeStr(cardData.subtypes)},
      ${escapeStr(cardData.hp)},
      ${escapeStr(cardData.types)},
      ${escapeStr(cardData.rarity)},
      ${escapeStr(cardData.artist)},
      ${escapeStr(cardData.set_id)},
      ${escapeStr(cardData.set_name)},
      ${escapeStr(cardData.number)},
      ${escapeStr(cardData.image_small)},
      ${escapeStr(cardData.image_large)},
      ${escapeStr(JSON.stringify(cardData.raw_data))},
      ${escapeStr(JSON.stringify(cardData.annotations))}
    )
  `);

  // Write-through to IndexedDB for persistence
  await idbPut(STORE_CUSTOM_CARDS, cardData);

  return cardData;
}

/**
 * Delete a custom card. Only cards with set_id starting with "custom-" can be deleted.
 */
export async function deleteCustomCard(cardId) {
  // Check if the card exists and is a custom card
  const result = await conn.query(
    `SELECT set_id FROM cards WHERE id = ${escapeStr(cardId)}`
  );
  const rows = result.toArray();

  if (rows.length === 0) {
    throw new Error(`Card '${cardId}' not found`);
  }

  if (!rows[0].set_id.startsWith("custom-")) {
    throw new Error("Only custom cards can be deleted");
  }

  // Delete from DuckDB
  await conn.query(`DELETE FROM cards WHERE id = ${escapeStr(cardId)}`);

  // Delete from IndexedDB
  await idbDelete(STORE_CUSTOM_CARDS, cardId);

  // Also delete any annotations for this card
  await idbDelete(STORE_ANNOTATIONS, cardId);
}

/**
 * Fetch all custom cards.
 */
export async function fetchCustomCards() {
  const result = await conn.query(`
    SELECT id, name, supertype, hp, types, rarity, set_id, set_name, number, image_small
    FROM cards
    WHERE set_id LIKE 'custom-%'
    ORDER BY set_id, name
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
  }));
}
