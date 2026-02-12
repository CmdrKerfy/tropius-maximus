/**
 * SqlConsole — An interactive SQL query editor with results table.
 *
 * Features:
 * - Textarea for entering SQL queries
 * - Run button + Ctrl/Cmd+Enter keyboard shortcut
 * - Results displayed in a scrollable table
 * - Error display for invalid queries
 * - Clickable example queries to get started
 */

import { useState, useRef, useCallback } from "react";
import { executeSql } from "../db";

const EXAMPLES = [
  { label: "All Columns (cards)", query: "SELECT * FROM cards LIMIT 5" },
  {
    label: "All Columns (pokemon_metadata)",
    query: "SELECT * FROM pokemon_metadata LIMIT 5",
  },
  { label: "All Columns (sets)", query: "SELECT * FROM sets LIMIT 5" },
  {
    label: "Custom Fields Definitions",
    query: "SELECT * FROM attribute_definitions",
  },
  {
    label: "Pokemon Type",
    query:
      "SELECT id, name, set_name, number, image_small FROM cards WHERE types ILIKE '%Fire%' LIMIT 50",
  },
  {
    label: "Pokemon Locations",
    query: `SELECT DISTINCT c.id, c.name, c.set_name, c.number, c.image_small, pm.encounter_location
FROM cards c
JOIN pokemon_metadata pm
  ON pm.pokedex_number = TRY_CAST(c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER)
WHERE pm.encounter_location IN ('Sinnoh Route 225 Area', 'Mt Coronet 1F Route 207')
LIMIT 50`,
  },
  {
    label: "Card Artists",
    query:
      "SELECT id, name, set_name, artist FROM cards WHERE artist ILIKE 'Sachiko Adachi'",
  },
  {
    label: "Selected Cards",
    query: "SELECT id, name, set_name FROM cards WHERE id IN {{selected}}",
  },
];

function isGridCompatible(res) {
  if (!res || !res.columns) return false;
  const cols = res.columns.map((c) => c.toLowerCase());
  // Direct grid: has id + image_small
  if (cols.includes("id") && cols.includes("image_small")) return "direct";
  // Needs auto-fetch: has id but no image_small
  if (cols.includes("id")) return "id_only";
  // Needs auto-join: has pokedex_number
  if (cols.includes("pokedex_number")) return "pokedex";
  return false;
}

function rowsToObjects(res) {
  return res.rows.map((row) =>
    Object.fromEntries(res.columns.map((col, i) => [col, row[i]]))
  );
}

export default function SqlConsole({
  onShowInGrid,
  onDataChanged,
  selectedCardIds = new Set(),
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const textareaRef = useRef(null);

  // Expand {{selected}} template variable with actual card IDs
  const expandTemplate = useCallback(
    (sql) => {
      if (!sql.includes("{{selected}}")) return sql;
      if (selectedCardIds.size === 0) {
        // Return a subquery that matches nothing (preserves SQL validity)
        return sql.replace(/\{\{selected\}\}/g, "(SELECT NULL WHERE FALSE)");
      }
      const idList = Array.from(selectedCardIds)
        .map((id) => `'${id.replace(/'/g, "''")}'`)
        .join(", ");
      return sql.replace(/\{\{selected\}\}/g, `(${idList})`);
    },
    [selectedCardIds]
  );

  const runQuery = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // Check for empty selection when using {{selected}}
    if (trimmed.includes("{{selected}}") && selectedCardIds.size === 0) {
      setError(
        "No cards selected. Select cards in the grid first, then use {{selected}} in your query."
      );
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);

    // Expand template before execution
    const expandedQuery = expandTemplate(trimmed);

    try {
      const data = await executeSql(expandedQuery);
      setResult(data);

      if (data.message && onDataChanged) {
        const lower = trimmed.toLowerCase();
        const changed = {};
        if (/attribute_definitions/.test(lower)) changed.attributes = true;
        if (/\bcards\b/.test(lower) || /\bpocket_cards\b/.test(lower) || /\bexclusive_cards\b/.test(lower) || /\bannotations\b/.test(lower))
          changed.cards = true;
        if (changed.attributes || changed.cards) onDataChanged(changed);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }, [query, onDataChanged, selectedCardIds, expandTemplate]);

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
  };

  const handleExample = (exampleQuery) => {
    setQuery(exampleQuery);
    setError(null);
    setResult(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <h2 className="font-semibold text-gray-800 mb-3">SQL Console</h2>

      {/* Example queries */}
      <div className="mb-3">
        <span className="text-xs text-gray-500 mr-2">Examples:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => handleExample(ex.query)}
            className="text-xs text-green-600 hover:text-green-800 mr-3 underline"
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Selection indicator */}
      {selectedCardIds.size > 0 && (
        <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded">
          <span className="font-medium">{selectedCardIds.size}</span> card
          {selectedCardIds.size !== 1 ? "s" : ""} selected. Use{" "}
          <code className="bg-green-100 px-1 rounded">{"{{selected}}"}</code> in
          your query.
        </div>
      )}

      {/* Query input */}
      <textarea
        ref={textareaRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter SQL query..."
        rows={4}
        className="w-full px-3 py-2 border border-gray-300 rounded font-mono text-sm
                   focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                   resize-y"
      />

      {/* Run button */}
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={runQuery}
          disabled={running || !query.trim()}
          className="px-4 py-1.5 bg-green-600 text-white rounded text-sm font-medium
                     hover:bg-green-700 disabled:bg-gray-400 transition-colors"
        >
          {running ? "Running..." : "Run Query"}
        </button>
        <span className="text-xs text-gray-400">
          {navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+Enter to run
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-3 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm font-mono whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Success message for non-SELECT queries */}
      {result && result.message && (
        <div className="mt-3 bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
          {result.message}
        </div>
      )}

      {/* Results table */}
      {result && result.columns.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">
              {result.row_count} row{result.row_count !== 1 ? "s" : ""}
            </span>
            {onShowInGrid && isGridCompatible(result) && (
              <button
                onClick={async () => {
                  const mode = isGridCompatible(result);
                  if (mode === "direct") {
                    onShowInGrid(rowsToObjects(result));
                  } else if (mode === "id_only") {
                    // Extract IDs and fetch full card data with images
                    const colIdx = result.columns.findIndex(
                      (c) => c.toLowerCase() === "id"
                    );
                    const ids = [
                      ...new Set(
                        result.rows.map((r) => r[colIdx]).filter((id) => id != null)
                      ),
                    ];
                    if (ids.length === 0) return;
                    const idList = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(", ");
                    const cardsResult = await executeSql(`
                      SELECT id, name, set_name, number, image_small
                      FROM cards
                      WHERE id IN (${idList})
                      LIMIT 200
                    `);
                    onShowInGrid(rowsToObjects(cardsResult));
                  } else if (mode === "pokedex") {
                    // Extract pokedex_numbers from results
                    const colIdx = result.columns.findIndex(
                      (c) => c.toLowerCase() === "pokedex_number"
                    );
                    const pokedexNums = [
                      ...new Set(
                        result.rows.map((r) => r[colIdx]).filter((n) => n != null)
                      ),
                    ];
                    if (pokedexNums.length === 0) return;
                    // Fetch cards matching these pokedex numbers
                    const cardsResult = await executeSql(`
                      SELECT DISTINCT c.id, c.name, c.set_name, c.number, c.image_small
                      FROM cards c
                      WHERE TRY_CAST(c.raw_data::JSON->'nationalPokedexNumbers'->>0 AS INTEGER)
                            IN (${pokedexNums.join(",")})
                      LIMIT 200
                    `);
                    onShowInGrid(rowsToObjects(cardsResult));
                  }
                }}
                className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded hover:bg-green-100 transition-colors"
              >
                Show in Grid
              </button>
            )}
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded max-h-96 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {result.columns.map((col, i) => (
                    <th
                      key={i}
                      className="px-3 py-1.5 text-left font-medium text-gray-700 border-b"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={ri % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-1.5 border-b border-gray-100 font-mono text-xs max-w-xs truncate"
                        title={String(cell ?? "")}
                      >
                        {cell === null ? (
                          <span className="text-gray-400 italic">NULL</span>
                        ) : (
                          String(cell)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
