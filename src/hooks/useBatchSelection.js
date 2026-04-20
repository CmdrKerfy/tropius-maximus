import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../lib/supabaseClient.js";
import {
  readBatchSelectionState,
  writeBatchSelectionIds,
  clearBatchSelectionStorage,
} from "../lib/batchSelectionStorage.js";
import { BATCH_EDIT_MAX_CARDS } from "../lib/batchLimits.js";
import { fetchFirstNMatchingCardIds, fetchBatchSelection, upsertBatchSelection } from "../db.js";

const SERVER_UPSERT_DEBOUNCE_MS = 400;

/**
 * Persisted multi-card selection for Batch (Explore + Card detail).
 * IDs live in localStorage; signed-in non-anonymous users also sync to `batch_selections` in Supabase.
 */
export function useBatchSelection(enabled) {
  const [userId, setUserId] = useState(null);
  const [userIsAnon, setUserIsAnon] = useState(true);
  const [ids, setIds] = useState(() => []);
  const serverSyncTimerRef = useRef(null);

  const flushServerUpsert = useCallback((unique) => {
    if (!enabled || userIsAnon || !userId) return;
    void upsertBatchSelection(unique).catch((e) => console.warn("batch selection sync:", e?.message || e));
  }, [enabled, userId, userIsAnon]);

  const scheduleServerUpsert = useCallback(
    (unique) => {
      if (!enabled || userIsAnon || !userId) return;
      if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
      serverSyncTimerRef.current = setTimeout(() => {
        serverSyncTimerRef.current = null;
        flushServerUpsert(unique);
      }, SERVER_UPSERT_DEBOUNCE_MS);
    },
    [enabled, userId, userIsAnon, flushServerUpsert]
  );

  useEffect(() => {
    if (!enabled) {
      setIds([]);
      setUserId(null);
      setUserIsAnon(true);
      return;
    }
    const sb = getSupabase();
    const sync = () => {
      void sb.auth.getUser().then(async ({ data: { user } }) => {
        const uid = user?.id ?? null;
        const anon = user?.is_anonymous === true;
        setUserId(uid);
        setUserIsAnon(anon);

        const local = readBatchSelectionState(uid);
        setIds(local.ids);

        if (!uid || anon) return;

        try {
          const row = await fetchBatchSelection();
          const serverTs = row?.updated_at ? Date.parse(row.updated_at) : 0;
          const localTs = local.updatedAtMs;
          if (row && serverTs > localTs) {
            const next = [...new Set(row.card_ids || [])].slice(0, BATCH_EDIT_MAX_CARDS);
            setIds(next);
            writeBatchSelectionIds(uid, next);
          } else if (local.ids.length > 0 && (!row || serverTs <= localTs)) {
            await upsertBatchSelection(local.ids);
          }
        } catch (e) {
          console.warn("batch selection server sync:", e?.message || e);
        }
      });
    };
    sync();
    const { data: sub } = sb.auth.onAuthStateChange(() => {
      sync();
    });
    return () => {
      sub.subscription.unsubscribe();
      if (serverSyncTimerRef.current) {
        clearTimeout(serverSyncTimerRef.current);
        serverSyncTimerRef.current = null;
      }
    };
  }, [enabled]);

  const persist = useCallback(
    (next) => {
      if (!enabled) return;
      const unique = [...new Set(next.filter(Boolean))].slice(0, BATCH_EDIT_MAX_CARDS);
      setIds(unique);
      writeBatchSelectionIds(userId, unique);
      scheduleServerUpsert(unique);
    },
    [enabled, userId, scheduleServerUpsert]
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onStorage = (e) => {
      if (e.key === null || e.key?.startsWith("tm_batch_selection_v")) {
        setIds(readBatchSelectionState(userId).ids);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, userId]);

  const idSet = useMemo(() => new Set(ids), [ids]);

  const add = useCallback(
    (id) => {
      if (!enabled || !id) return false;
      if (ids.includes(id)) return true;
      if (ids.length >= BATCH_EDIT_MAX_CARDS) return false;
      persist([...ids, id]);
      return true;
    },
    [enabled, ids, persist]
  );

  const remove = useCallback(
    (id) => {
      if (!enabled) return;
      persist(ids.filter((x) => x !== id));
    },
    [enabled, ids, persist]
  );

  const toggle = useCallback(
    (id) => {
      if (!enabled || !id) return;
      if (ids.includes(id)) remove(id);
      else add(id);
    },
    [add, enabled, ids, remove]
  );

  const clear = useCallback(() => {
    if (!enabled) return;
    if (serverSyncTimerRef.current) {
      clearTimeout(serverSyncTimerRef.current);
      serverSyncTimerRef.current = null;
    }
    setIds([]);
    clearBatchSelectionStorage(userId);
    if (userId && !userIsAnon) {
      void upsertBatchSelection([]).catch((e) => console.warn("batch selection clear sync:", e?.message || e));
    }
  }, [enabled, userId, userIsAnon]);

  const addMany = useCallback(
    (more) => {
      if (!enabled || !more?.length) return { added: 0, skippedCap: false };
      const prevLen = ids.length;
      const merged = [...new Set([...ids, ...more.filter(Boolean)])];
      const skippedCap = merged.length > BATCH_EDIT_MAX_CARDS;
      const capped = merged.slice(0, BATCH_EDIT_MAX_CARDS);
      persist(capped);
      return { added: capped.length - prevLen, skippedCap };
    },
    [enabled, ids, persist]
  );

  const selectAllMatchingExplore = useCallback(
    async (listParams) => {
      if (!enabled) return { added: 0, totalMatch: 0, capped: false };
      const prev = new Set(ids);
      const { ids: found, totalMatch, capped } = await fetchFirstNMatchingCardIds(listParams, BATCH_EDIT_MAX_CARDS);
      const merged = [...new Set([...ids, ...found])].slice(0, BATCH_EDIT_MAX_CARDS);
      const added = merged.filter((x) => !prev.has(x)).length;
      persist(merged);
      return { added, totalMatch, capped };
    },
    [enabled, ids, persist]
  );

  const isInBatch = useCallback((id) => idSet.has(id), [idSet]);

  return useMemo(
    () => ({
      ids,
      idSet,
      count: ids.length,
      add,
      remove,
      toggle,
      clear,
      addMany,
      selectAllMatchingExplore,
      isInBatch,
      maxCards: BATCH_EDIT_MAX_CARDS,
    }),
    [ids, idSet, add, remove, toggle, clear, addMany, selectAllMatchingExplore, isInBatch]
  );
}
