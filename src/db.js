/**
 * Data layer router: DuckDB-WASM (v1 static site) or Supabase (v2) based on env.
 *
 * Set VITE_USE_SUPABASE=true and VITE_SUPABASE_* in .env.local for Postgres-backed mode.
 */
import * as duck from "./db.duckdb.js";
import { SOURCE_OPTIONS } from "./lib/annotationOptions.js";
import { buildManualCardId, normalizeCardNumberForStorage } from "./lib/manualCardId.js";

export { buildManualCardId, normalizeCardNumberForStorage };

/** True when the app should use Postgres via Supabase (Explore, Workbench, etc.). */
export function useSupabaseBackend() {
  return (
    import.meta.env.VITE_USE_SUPABASE === "true" &&
    Boolean(import.meta.env.VITE_SUPABASE_URL) &&
    Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)
  );
}

let _sbAdapter = null;
async function sb() {
  if (!_sbAdapter) _sbAdapter = await import("./data/supabase/appAdapter.js");
  return _sbAdapter;
}

export function getCustomSourceNames() {
  if (useSupabaseBackend()) return [...SOURCE_OPTIONS];
  return duck.getCustomSourceNames();
}

export async function initDB() {
  if (useSupabaseBackend()) {
    const { assertSupabaseConfigured, getSupabase } = await import("./lib/supabaseClient.js");
    assertSupabaseConfigured();
    const sb = getSupabase();
    if (import.meta.env.VITE_REQUIRE_EMAIL_AUTH === "true") {
      await sb.auth.getSession();
      return;
    }
    const { ensureSupabaseSession } = await import("./lib/supabaseAuthBootstrap.js");
    await ensureSupabaseSession();
    return;
  }
  return duck.initDB();
}

export async function fetchCards(params) {
  return useSupabaseBackend() ? (await sb()).fetchCards(params) : duck.fetchCards(params);
}

export async function fetchCard(id, source = "TCG") {
  return useSupabaseBackend()
    ? (await sb()).fetchCard(id, source)
    : duck.fetchCard(id, source);
}

/** Public share page — one card via RPC; no auth session required. */
export async function fetchPublicCardForShare(cardId) {
  if (!useSupabaseBackend()) return null;
  return (await sb()).fetchPublicCardForShare(cardId);
}

export async function fetchFilterOptions(source = "TCG") {
  return useSupabaseBackend()
    ? (await sb()).fetchFilterOptions(source)
    : duck.fetchFilterOptions(source);
}

/** Explore grid: merged filter dropdown values (stable when Source changes). */
export async function fetchExploreFilterOptions() {
  return useSupabaseBackend()
    ? (await sb()).fetchExploreFilterOptions()
    : duck.fetchExploreFilterOptions();
}

export async function fetchFormOptions() {
  return useSupabaseBackend() ? (await sb()).fetchFormOptions() : duck.fetchFormOptions();
}

/** TanStack Query key for `fetchFormOptions` (Workbench, CardDetail, CustomCardForm). */
export const FORM_OPTIONS_QUERY_KEY = ["formOptions"];

export async function fetchAnnotations(cardId) {
  return useSupabaseBackend()
    ? (await sb()).fetchAnnotations(cardId)
    : duck.fetchAnnotations(cardId);
}

export async function patchAnnotations(cardId, annotations, options) {
  return useSupabaseBackend()
    ? (await sb()).patchAnnotations(cardId, annotations, options)
    : duck.patchAnnotations(cardId, annotations, options);
}

export async function fetchMatchingCardIds(params) {
  return useSupabaseBackend()
    ? (await sb()).fetchMatchingCardIds(params)
    : duck.fetchMatchingCardIds(params);
}

/** First N matching card IDs (same filters as Explore); Supabase only. */
export async function fetchFirstNMatchingCardIds(params, limit) {
  return useSupabaseBackend()
    ? (await sb()).fetchFirstNMatchingCardIds(params, limit)
    : duck.fetchFirstNMatchingCardIds(params, limit);
}

export { BATCH_EDIT_MAX_CARDS } from "./lib/batchLimits.js";

export async function batchPatchAnnotations(cardIds, patch, options) {
  return useSupabaseBackend()
    ? (await sb()).batchPatchAnnotations(cardIds, patch, options)
    : duck.batchPatchAnnotations(cardIds, patch, options);
}

export async function fetchBatchWizardPreview(cardIds, fieldKey) {
  return useSupabaseBackend()
    ? (await sb()).fetchBatchWizardPreview(cardIds, fieldKey)
    : duck.fetchBatchWizardPreview(cardIds, fieldKey);
}

export async function fetchCardNamesByIds(cardIds) {
  return useSupabaseBackend()
    ? (await sb()).fetchCardNamesByIds(cardIds)
    : duck.fetchCardNamesByIds(cardIds);
}

export async function fetchCardThumbnailsByIds(cardIds) {
  return useSupabaseBackend()
    ? (await sb()).fetchCardThumbnailsByIds(cardIds)
    : {};
}

export async function appendCuratedOptionsForCustomField(fieldName, newStrings) {
  return useSupabaseBackend()
    ? (await sb()).appendCuratedOptionsForCustomField(fieldName, newStrings)
    : duck.appendCuratedOptionsForCustomField(fieldName, newStrings);
}

export async function fetchEditHistory(params) {
  return useSupabaseBackend()
    ? (await sb()).fetchEditHistory(params)
    : duck.fetchEditHistory(params);
}

/** Server-backed Batch list (Supabase); null when unsigned-in or anonymous. */
export async function fetchBatchSelection() {
  return useSupabaseBackend() ? (await sb()).fetchBatchSelection() : duck.fetchBatchSelection();
}

/** Persist Batch list to Supabase (no-op in v1 / anonymous). */
export async function upsertBatchSelection(cardIds) {
  return useSupabaseBackend()
    ? (await sb()).upsertBatchSelection(cardIds)
    : duck.upsertBatchSelection(cardIds);
}

export async function createBatchRun(meta) {
  return useSupabaseBackend() ? (await sb()).createBatchRun(meta) : duck.createBatchRun(meta);
}

export async function fetchBatchRuns(opts) {
  return useSupabaseBackend() ? (await sb()).fetchBatchRuns(opts) : duck.fetchBatchRuns(opts);
}

export async function fetchProfile() {
  return useSupabaseBackend() ? (await sb()).fetchProfile() : null;
}

export async function fetchProfileById(userId) {
  return useSupabaseBackend() ? (await sb()).fetchProfileById(userId) : null;
}

export async function upsertProfile(patch) {
  if (useSupabaseBackend()) return (await sb()).upsertProfile(patch);
  throw new Error("Profile updates require Supabase (v2).");
}

export async function uploadProfileAvatar(file) {
  if (useSupabaseBackend()) return (await sb()).uploadProfileAvatar(file);
  throw new Error("Avatar upload requires Supabase (v2).");
}

export async function removeProfileAvatar() {
  if (useSupabaseBackend()) return (await sb()).removeProfileAvatar();
  throw new Error("Avatar removal requires Supabase (v2).");
}

export async function fetchMyEditHistory(opts) {
  return useSupabaseBackend() ? (await sb()).fetchMyEditHistory(opts) : [];
}

export async function fetchMyCards(opts) {
  return useSupabaseBackend() ? (await sb()).fetchMyCards(opts) : [];
}

export async function renameManualCard(cardId, newName) {
  if (!useSupabaseBackend()) {
    throw new Error("Card rename requires Supabase (v2).");
  }
  return (await sb()).renameManualCard(cardId, newName);
}

export async function fetchAttributes() {
  return useSupabaseBackend() ? (await sb()).fetchAttributes() : duck.fetchAttributes();
}

export async function createAttribute(attr) {
  return useSupabaseBackend()
    ? (await sb()).createAttribute(attr)
    : duck.createAttribute(attr);
}

export async function deleteAttribute(key) {
  return useSupabaseBackend()
    ? (await sb()).deleteAttribute(key)
    : duck.deleteAttribute(key);
}

export async function executeSql(query) {
  return useSupabaseBackend() ? (await sb()).executeSql(query) : duck.executeSql(query);
}

export async function exportAllAnnotations() {
  return useSupabaseBackend()
    ? (await sb()).exportAllAnnotations()
    : duck.exportAllAnnotations();
}

export async function fetchDataHealthSummary() {
  return useSupabaseBackend()
    ? (await sb()).fetchDataHealthSummary()
    : duck.fetchDataHealthSummary();
}

export async function fetchAnnotationValueIssues(opts) {
  if (!useSupabaseBackend()) return [];
  return (await sb()).fetchAnnotationValueIssues(opts);
}

export async function fetchCardsForAnnotationValueIssue(opts) {
  if (!useSupabaseBackend()) return [];
  return (await sb()).fetchCardsForAnnotationValueIssue(opts);
}

export async function applyAnnotationValueCleanup(opts) {
  if (!useSupabaseBackend()) {
    throw new Error("Data Health cleanup requires Supabase (v2).");
  }
  return (await sb()).applyAnnotationValueCleanup(opts);
}

export async function syncMutableTablesToIndexedDB() {
  return useSupabaseBackend()
    ? (await sb()).syncMutableTablesToIndexedDB()
    : duck.syncMutableTablesToIndexedDB();
}

export async function triggerIngest() {
  return useSupabaseBackend() ? (await sb()).triggerIngest() : duck.triggerIngest();
}

export async function addCustomSet(set) {
  return useSupabaseBackend() ? (await sb()).addCustomSet(set) : duck.addCustomSet(set);
}

export async function addTcgCard(card) {
  return useSupabaseBackend() ? (await sb()).addTcgCard(card) : duck.addTcgCard(card);
}

export async function addPocketCard(card) {
  return useSupabaseBackend()
    ? (await sb()).addPocketCard(card)
    : duck.addPocketCard(card);
}

export async function addCustomCard(card) {
  return useSupabaseBackend()
    ? (await sb()).addCustomCard(card)
    : duck.addCustomCard(card);
}

/** Resolves manual card id: Supabase RPC `generate_card_id`, else local `buildManualCardId`. */
export async function generateManualCardId(setId, number) {
  if (useSupabaseBackend()) {
    return (await import("./data/supabase/appAdapter.js")).rpcGenerateManualCardId(
      setId,
      number
    );
  }
  return buildManualCardId(setId, number);
}

function assertCardDeleteAcknowledged(options) {
  if (options?.acknowledged === true) return;
  throw new Error(
    "Card delete requires explicit user acknowledgment. Confirm the warning prompt before deleting."
  );
}

export async function deleteCardsById(cardIds, options = {}) {
  assertCardDeleteAcknowledged(options);
  return useSupabaseBackend()
    ? (await sb()).deleteCardsById(cardIds, options)
    : duck.deleteCardsById(cardIds, options);
}

export async function fetchWorkbenchQueues() {
  return useSupabaseBackend()
    ? (await sb()).fetchWorkbenchQueues()
    : duck.fetchWorkbenchQueues();
}

export async function ensureDefaultWorkbenchQueue() {
  return useSupabaseBackend()
    ? (await sb()).ensureDefaultWorkbenchQueue()
    : duck.ensureDefaultWorkbenchQueue();
}

export async function updateWorkbenchQueue(queueId, patch) {
  return useSupabaseBackend()
    ? (await sb()).updateWorkbenchQueue(queueId, patch)
    : duck.updateWorkbenchQueue(queueId, patch);
}

export async function createWorkbenchQueue(payload) {
  if (!useSupabaseBackend()) {
    throw new Error("Shared Workbench lists require Supabase (v2).");
  }
  return (await sb()).createWorkbenchQueue(payload);
}

export async function deleteWorkbenchQueue(queueId) {
  if (!useSupabaseBackend()) {
    throw new Error("Shared Workbench lists require Supabase (v2).");
  }
  return (await sb()).deleteWorkbenchQueue(queueId);
}

export async function appendCardToDefaultQueue(cardId) {
  return useSupabaseBackend()
    ? (await sb()).appendCardToDefaultQueue(cardId)
    : duck.appendCardToDefaultQueue(cardId);
}

export async function appendCardsToDefaultQueue(cardIds) {
  return useSupabaseBackend()
    ? (await sb()).appendCardsToDefaultQueue(cardIds)
    : duck.appendCardsToDefaultQueue(cardIds);
}

export async function appendCardToWorkbenchQueue(queueId, cardId) {
  if (!useSupabaseBackend()) {
    throw new Error("Shared Workbench lists require Supabase (v2).");
  }
  return (await sb()).appendCardToWorkbenchQueue(queueId, cardId);
}

export async function appendCardsToWorkbenchQueue(queueId, cardIds) {
  if (!useSupabaseBackend()) {
    throw new Error("Shared Workbench lists require Supabase (v2).");
  }
  return (await sb()).appendCardsToWorkbenchQueue(queueId, cardIds);
}

export async function moveCardsBetweenWorkbenchQueues(sourceQueueId, targetQueueId, cardIds) {
  if (!useSupabaseBackend()) {
    throw new Error("Shared Workbench lists require Supabase (v2).");
  }
  return (await sb()).moveCardsBetweenWorkbenchQueues(sourceQueueId, targetQueueId, cardIds);
}

const LS_CARD_DETAIL_PINS = "tm_card_detail_pins";

/** @returns {Promise<{ card_detail_pins?: string[], quick_fields?: unknown, default_category?: string } | null>} */
export async function fetchUserPreferences() {
  if (useSupabaseBackend()) return (await sb()).fetchUserPreferences();
  try {
    if (typeof localStorage === "undefined") return { card_detail_pins: [] };
    const raw = localStorage.getItem(LS_CARD_DETAIL_PINS);
    const parsed = raw ? JSON.parse(raw) : [];
    const pins = Array.isArray(parsed) ? parsed : [];
    return { card_detail_pins: pins };
  } catch {
    return { card_detail_pins: [] };
  }
}

/**
 * @param {{ card_detail_pins?: string[] }} patch
 * @returns {Promise<object>}
 */
export async function upsertUserPreferences(patch) {
  if (useSupabaseBackend()) return (await sb()).upsertUserPreferences(patch);
  if (patch.card_detail_pins !== undefined) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LS_CARD_DETAIL_PINS, JSON.stringify(patch.card_detail_pins));
      }
    } catch {
      /* ignore */
    }
    return { card_detail_pins: patch.card_detail_pins };
  }
  return { card_detail_pins: [] };
}
