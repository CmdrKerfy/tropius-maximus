/**
 * Saved batch list wizard: field(s) → review → confirm → apply.
 */

import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildPatch,
  curatedPromotionStringsFromInputs,
  formatAnnotationValueForDisplay,
  hasMeaningfulAnnotationValue,
  mergeFieldStepsToPatch,
  fieldStepKeysUnique,
  MAX_FIELD_STEPS,
} from "../lib/batchEditPatch.js";
import {
  appendCardsToDefaultQueue,
  appendCardsToWorkbenchQueue,
  appendCuratedOptionsForCustomField,
  batchPatchAnnotations,
  createBatchRun,
  fetchWorkbenchQueues,
  fetchBatchWizardPreview,
  fetchCardNamesByIds,
  FORM_OPTIONS_QUERY_KEY,
} from "../db";
import { toastError, toastSuccess, toastWarning } from "../lib/toast.js";
import {
  BATCH_ERROR_BUCKET_LABELS,
  BATCH_ERROR_BUCKET_ORDER,
  groupBatchErrorsByBucket,
} from "../lib/batchErrorBuckets.js";
import { batchErrorHint } from "../lib/batchErrorHints.js";
import BatchFieldStepBlock, { summarizeStepPatch } from "./BatchFieldStepBlock.jsx";

const LARGE_THRESHOLD = 75;
const TYPED_COUNT_THRESHOLD = 25;
const PREVIEW_CAP = 48;
const WORKBENCH_QUEUE_STORAGE_KEY = "tm_workbench_queue_id";

function newStep() {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fieldKey: "",
    mode: "set",
    textValue: "",
    boolValue: false,
    promoteCurated: false,
  };
}

export default function BatchWizard({ batchSelection, attributes, attrPending }) {
  const queryClient = useQueryClient();
  const ids = batchSelection.ids;
  const total = ids.length;
  const idsKey = useMemo(() => ids.join("\0"), [ids]);
  const [workbenchQueueId, setWorkbenchQueueId] = useState(() => {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(WORKBENCH_QUEUE_STORAGE_KEY) || ""
        : "";
    } catch {
      return "";
    }
  });
  const [workbenchListAppendBusy, setWorkbenchListAppendBusy] = useState(false);
  const [showWorkbenchTargetPicker, setShowWorkbenchTargetPicker] = useState(false);

  const [phase, setPhase] = useState("field");
  const [fieldSteps, setFieldSteps] = useState(() => [newStep()]);
  const [trialLimit, setTrialLimit] = useState(0);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [batchCountConfirm, setBatchCountConfirm] = useState("");
  const [batchProgress, setBatchProgress] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  /** ISO timestamp for History deep-link (first apply pass only; retries keep the same window). */
  const batchRunSinceRef = useRef(null);
  /** Same batch run for “retry failed” so edit_history stays under one run id. */
  const lastBatchRunIdRef = useRef(null);

  const previewFieldKey = fieldSteps[0]?.fieldKey ?? "";
  const firstAttr = useMemo(
    () => attributes.find((a) => a.key === previewFieldKey) || null,
    [attributes, previewFieldKey]
  );

  const needsTypedCount = total >= TYPED_COUNT_THRESHOLD;
  const typedCountOk = !needsTypedCount || batchCountConfirm.trim() === String(total);
  const needsConfirm = total > LARGE_THRESHOLD;

  const effectiveTotal = useMemo(() => {
    if (trialLimit <= 0) return total;
    return Math.min(trialLimit, total);
  }, [trialLimit, total]);

  useEffect(() => {
    setPhase("field");
    setBatchCountConfirm("");
    setConfirmLarge(false);
    setBatchProgress(null);
    setFieldSteps([newStep()]);
    setTrialLimit(0);
    lastBatchRunIdRef.current = null;
  }, [idsKey]);

  useEffect(() => {
    setBatchCountConfirm("");
  }, [total]);

  const { data: workbenchQueues = [] } = useQuery({
    queryKey: ["workbenchQueues"],
    queryFn: fetchWorkbenchQueues,
  });

  const selectedWorkbenchQueue = useMemo(() => {
    if (!workbenchQueues.length) return null;
    const found = workbenchQueueId
      ? workbenchQueues.find((q) => String(q.id) === String(workbenchQueueId))
      : null;
    return found || workbenchQueues[0];
  }, [workbenchQueues, workbenchQueueId]);

  useEffect(() => {
    if (!selectedWorkbenchQueue?.id) return;
    setWorkbenchQueueId(String(selectedWorkbenchQueue.id));
  }, [selectedWorkbenchQueue?.id]);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        if (workbenchQueueId) localStorage.setItem(WORKBENCH_QUEUE_STORAGE_KEY, workbenchQueueId);
        else localStorage.removeItem(WORKBENCH_QUEUE_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [workbenchQueueId]);

  useEffect(() => {
    if (workbenchQueues.length <= 1) setShowWorkbenchTargetPicker(false);
  }, [workbenchQueues.length]);

  const handleBatchListToWorkbench = async (queueIdOverride = null) => {
    if (total === 0) return;
    setWorkbenchListAppendBusy(true);
    try {
      const targetQueue =
        (queueIdOverride != null
          ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
          : null) || selectedWorkbenchQueue || null;
      const queueId = targetQueue?.id;
      const queueName = targetQueue?.name || "Workbench";
      const { added, capped, max } = queueId
        ? await appendCardsToWorkbenchQueue(queueId, ids)
        : await appendCardsToDefaultQueue(ids);
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (queueId != null) setWorkbenchQueueId(String(queueId));
      if (added === 0 && capped) {
        toastWarning(
          `"${queueName}" is full (${Number(max || batchSelection.maxCards).toLocaleString()} cards). Remove some cards before adding more.`
        );
      } else if (added === 0) {
        toastWarning(`Every card in your batch list was already in "${queueName}".`);
      } else if (capped) {
        toastWarning(
          `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} to "${queueName}". The list is capped at ${Number(max || batchSelection.maxCards).toLocaleString()} cards; some were skipped.`
        );
      } else {
        toastSuccess(`Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} to "${queueName}".`);
      }
      setShowWorkbenchTargetPicker(false);
    } catch (err) {
      toastError(err);
    } finally {
      setWorkbenchListAppendBusy(false);
    }
  };

  const previewKey = useMemo(() => ids.slice(0, PREVIEW_CAP).join(","), [idsKey]);

  const { data: previewData, isPending: previewPending } = useQuery({
    queryKey: ["batchWizardPreview", previewFieldKey, previewKey],
    queryFn: () => fetchBatchWizardPreview(ids, previewFieldKey),
    enabled: phase === "review" && Boolean(previewFieldKey) && total > 0,
  });

  const mergePatch = useMemo(() => {
    try {
      return mergeFieldStepsToPatch(attributes, fieldSteps);
    } catch {
      return null;
    }
  }, [attributes, fieldSteps]);

  const firstPatch = useMemo(() => {
    const s = fieldSteps[0];
    if (!s?.fieldKey) return null;
    const attr = attributes.find((a) => a.key === s.fieldKey);
    if (!attr) return null;
    try {
      return buildPatch(attr, s.mode, s.textValue, s.boolValue);
    } catch {
      return null;
    }
  }, [attributes, fieldSteps]);

  const overwriteSamples = useMemo(() => {
    if (!previewData?.cards || !firstAttr || fieldSteps[0]?.mode === "clear" || !firstPatch) return [];
    const key = firstAttr.key;
    const nextVal = firstPatch[key];
    return previewData.cards.filter(
      (c) =>
        hasMeaningfulAnnotationValue(c.previousValue) &&
        JSON.stringify(c.previousValue) !== JSON.stringify(nextVal)
    );
  }, [previewData, firstAttr, fieldSteps, firstPatch]);

  const updateStep = (idx, partial) => {
    setFieldSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...partial } : s)));
  };

  const addStep = () => {
    setFieldSteps((prev) => (prev.length >= MAX_FIELD_STEPS ? prev : [...prev, newStep()]));
  };

  const removeStep = (idx) => {
    setFieldSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const runBatch = useMutation({
    mutationFn: async ({ idsOverride } = {}) => {
      const isRetryPass = Boolean(idsOverride);
      const targetIds =
        idsOverride ??
        (trialLimit > 0 ? ids.slice(0, Math.min(trialLimit, ids.length)) : ids);

      if (!isRetryPass) {
        batchRunSinceRef.current = new Date().toISOString();
      }

      for (const step of fieldSteps) {
        if (!step.fieldKey) throw new Error("Choose a field in every row (or remove empty rows).");
        const attr = attributes.find((a) => a.key === step.fieldKey);
        if (!attr) throw new Error("Unknown field.");
        buildPatch(attr, step.mode, step.textValue, step.boolValue);
      }
      if (!fieldStepKeysUnique(fieldSteps)) {
        throw new Error("Each field can only appear once in this run.");
      }

      if (targetIds.length === 0) throw new Error("No cards in your batch list.");
      if (
        !isRetryPass &&
        needsTypedCount &&
        batchCountConfirm.trim() !== String(total)
      ) {
        throw new Error(`Type the matching card count (${total}) in the confirmation box.`);
      }
      if (!isRetryPass && needsConfirm && !confirmLarge) throw new Error("Confirm the large update below.");

      const patch = mergeFieldStepsToPatch(attributes, fieldSteps);
      let batchRunId = null;
      if (!isRetryPass) {
        batchRunId = await createBatchRun({
          field_name: fieldSteps.map((s) => s.fieldKey).filter(Boolean).join(", "),
          card_count: targetIds.length,
        });
        lastBatchRunIdRef.current = batchRunId;
      } else {
        batchRunId = lastBatchRunIdRef.current;
      }

      setBatchProgress({ done: 0, total: targetIds.length });
      const batchResult = await batchPatchAnnotations(targetIds, patch, {
        onProgress: (done, tot) => setBatchProgress({ done, total: tot }),
        batchRunId,
      });

      let curatedAppended = [];
      let curatedAppendError = null;
      if (batchResult.updated > 0) {
        for (const step of fieldSteps) {
          if (!step.promoteCurated) continue;
          const attr = attributes.find((a) => a.key === step.fieldKey);
          if (
            !attr ||
            attr.is_builtin ||
            (attr.value_type !== "select" && attr.value_type !== "multi_select") ||
            step.mode !== "set"
          ) {
            continue;
          }
          const strings = curatedPromotionStringsFromInputs(attr, step.mode, step.textValue, step.boolValue);
          if (strings.length) {
            try {
              const r = await appendCuratedOptionsForCustomField(attr.key, strings);
              curatedAppended = [...curatedAppended, ...(r.appended || [])];
            } catch (e) {
              curatedAppendError = e;
            }
          }
        }
      }

      const startIso = batchRunSinceRef.current;
      const sinceForHistory =
        startIso && Number.isFinite(Date.parse(startIso))
          ? new Date(Date.parse(startIso) - 3000).toISOString()
          : startIso;

      const singleFieldKey =
        fieldSteps.length === 1 && fieldSteps[0]?.fieldKey ? fieldSteps[0].fieldKey : "";

      return {
        ...batchResult,
        curatedAppended,
        curatedAppendError,
        batchRunSince: sinceForHistory,
        batchFieldKey: singleFieldKey,
        batchRunId,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
      queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["editHistory"] });
      queryClient.invalidateQueries({ queryKey: ["batchRuns"] });
      if (result.curatedAppended?.length) {
        queryClient.invalidateQueries({ queryKey: ["attributes"] });
      }
      setPhase("done");
      const optParts = [];
      if (result.curatedAppended?.length) {
        optParts.push(`Field options added: ${[...new Set(result.curatedAppended)].join(", ")}`);
      }
      if (result.curatedAppendError) {
        optParts.push(`Field options not saved: ${result.curatedAppendError.message || String(result.curatedAppendError)}`);
      }
      const optDesc = optParts.length ? optParts.join(" · ") : undefined;
      if (result.errors.length === 0) {
        toastSuccess(`Updated ${result.updated.toLocaleString()} card${result.updated === 1 ? "" : "s"}.`, optDesc ? { description: optDesc } : undefined);
      } else {
        toastWarning(`Updated ${result.updated.toLocaleString()} cards with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`, {
          description: [optDesc, "Expand the result details below for per-card messages."].filter(Boolean).join(" "),
        });
      }
    },
    onError: (err) => {
      toastError(err);
    },
    onSettled: () => setBatchProgress(null),
  });

  const failedIds = runBatch.data?.errors?.map((e) => e.cardId) ?? [];

  const failedByBucket = useMemo(
    () => groupBatchErrorsByBucket(runBatch.data?.errors ?? []),
    [runBatch.data?.errors]
  );

  const failedIdsKey = failedIds.length ? [...failedIds].sort().join(",") : "";

  const { data: errorNames = {} } = useQuery({
    queryKey: ["batchWizardErrorNames", failedIdsKey],
    queryFn: () => fetchCardNamesByIds(failedIds),
    enabled: failedIds.length > 0 && phase === "done",
  });

  const sortedAttrs = useMemo(
    () => [...attributes].sort((a, b) => (a.label || a.key).localeCompare(b.label || b.key)),
    [attributes]
  );

  const continueToReview = () => {
    for (const step of fieldSteps) {
      if (!step.fieldKey) {
        toastError(new Error("Choose a field in every row."));
        return;
      }
      const attr = attributes.find((a) => a.key === step.fieldKey);
      if (!attr) {
        toastError(new Error("Unknown field."));
        return;
      }
      try {
        buildPatch(attr, step.mode, step.textValue, step.boolValue);
      } catch (e) {
        toastError(e);
        return;
      }
    }
    if (!fieldStepKeysUnique(fieldSteps)) {
      toastError(new Error("Each field can only appear once."));
      return;
    }
    setPhase("review");
  };

  const copyFailedIds = async () => {
    if (!failedIds.length) return;
    try {
      await navigator.clipboard.writeText(failedIds.join("\n"));
      toastSuccess("Copied failed card IDs to clipboard.");
    } catch (e) {
      toastError(e);
    }
  };

  const retryFailed = () => {
    if (!failedIds.length) return;
    runBatch.mutate({ idsOverride: failedIds });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Saved batch</p>
            <p className="text-lg font-semibold text-gray-900 tabular-nums">
              {total.toLocaleString()} card{total !== 1 ? "s" : ""}
              {total >= batchSelection.maxCards ? (
                <span className="ml-2 text-sm font-normal text-amber-800">(at {batchSelection.maxCards.toLocaleString()} cap)</span>
              ) : null}
            </p>
          </div>
          <Link
            to="/"
            className="text-sm font-medium text-green-700 underline hover:text-green-800"
          >
            Add or remove cards on Explore
          </Link>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          This run uses your saved list only (not the Explore URL). Clear the list from Explore if you need to start over.
        </p>
        <div className="pt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (workbenchQueues.length > 1 && !showWorkbenchTargetPicker) {
                setShowWorkbenchTargetPicker(true);
                return;
              }
              void handleBatchListToWorkbench(selectedWorkbenchQueue?.id ?? undefined);
            }}
            disabled={total === 0 || workbenchListAppendBusy}
            title="Add this saved batch list to the selected Workbench list (deduped; does not replace the list)"
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {workbenchListAppendBusy ? "Adding…" : "Add list to Workbench"}
          </button>
          {showWorkbenchTargetPicker && workbenchQueues.length > 1 && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-1.5 py-1">
              <select
                value={selectedWorkbenchQueue?.id ?? ""}
                onChange={(e) => setWorkbenchQueueId(String(e.target.value))}
                className="h-8 rounded border border-sky-300 bg-white px-2 text-xs text-sky-950"
              >
                {workbenchQueues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name || "Untitled list"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleBatchListToWorkbench(selectedWorkbenchQueue?.id ?? undefined)}
                disabled={workbenchListAppendBusy}
                className="h-8 rounded bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {workbenchListAppendBusy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setShowWorkbenchTargetPicker(false)}
                className="h-8 rounded border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {phase === "field" && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
          <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Step 1 — Field(s) and value(s)</p>
          <p className="text-xs text-gray-600">
            Add up to {MAX_FIELD_STEPS} fields; all are applied together in one run (same value pattern per field for every
            card).
          </p>

          <div className="space-y-3">
            {fieldSteps.map((step, idx) => (
              <BatchFieldStepBlock
                key={step.id}
                step={step}
                stepIndex={idx}
                stepCount={fieldSteps.length}
                sortedAttrs={sortedAttrs}
                attrPending={attrPending}
                onChange={(partial) => updateStep(idx, partial)}
                onRemove={idx > 0 ? () => removeStep(idx) : undefined}
              />
            ))}
          </div>

          {fieldSteps.length < MAX_FIELD_STEPS ? (
            <button
              type="button"
              onClick={addStep}
              className="text-sm font-medium text-green-700 underline hover:text-green-800"
            >
              + Add another field
            </button>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={runBatch.isPending}
              onClick={continueToReview}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue to review
            </button>
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
          <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Step 2 — Review</p>
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-800 space-y-2">
            <p>
              <span className="text-gray-500">Cards:</span>{" "}
              <span className="font-semibold tabular-nums">{total.toLocaleString()}</span>
            </p>
            <div className="space-y-1">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Changes</p>
              <ul className="list-disc pl-5 space-y-1">
                {fieldSteps.map((step, i) => {
                  const attr = attributes.find((a) => a.key === step.fieldKey);
                  if (!attr) return null;
                  return (
                    <li key={step.id}>
                      <span className="font-medium">{attr.label || attr.key}</span>:{" "}
                      {summarizeStepPatch(attr, step.mode, step.textValue, step.boolValue)}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="text-sm font-medium text-green-700 underline"
            >
              {previewOpen ? "Hide" : "Show"} sample thumbnails ({Math.min(PREVIEW_CAP, total)} of {total.toLocaleString()}) —{" "}
              <span className="font-normal text-gray-600">first field only</span>
            </button>
            {previewOpen && (
              <div className="mt-2">
                {previewPending ? (
                  <p className="text-xs text-gray-400">Loading sample…</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(previewData?.cards || []).map((c) => (
                      <Link
                        key={c.id}
                        to={`/?card=${encodeURIComponent(c.id)}`}
                        className="shrink-0 w-[72px] text-center hover:opacity-90"
                      >
                        <img
                          src={c.image_small || c.image_large || ""}
                          alt=""
                          className="h-[88px] w-full object-contain rounded border border-gray-200 bg-white"
                        />
                        <span className="block mt-1 text-[10px] text-gray-600 line-clamp-2 leading-tight">{c.name || c.id}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {overwriteSamples.length > 0 && fieldSteps[0]?.mode === "set" && (
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-sm">
              <p className="font-medium text-amber-950 mb-2">Overwrite preview (sample — first field)</p>
              <p className="text-xs text-amber-900/90 mb-2">
                These cards already have a value for the first field. After the run, it will be replaced.
              </p>
              <ul className="space-y-2 max-h-40 overflow-y-auto text-xs">
                {overwriteSamples.slice(0, 12).map((c) => (
                  <li key={c.id} className="border-b border-amber-100/80 pb-2 last:border-0">
                    <span className="font-medium text-gray-900">{c.name || c.id}</span>
                    <div className="mt-0.5 text-gray-700">
                      <span className="text-gray-500">Before:</span> {formatAnnotationValueForDisplay(c.previousValue)}
                    </div>
                    <div className="text-gray-700">
                      <span className="text-gray-500">After:</span>{" "}
                      {firstPatch && firstAttr ? formatAnnotationValueForDisplay(firstPatch[firstAttr.key]) : "—"}
                    </div>
                  </li>
                ))}
              </ul>
              {overwriteSamples.length > 12 ? (
                <p className="text-[11px] text-amber-900/80 mt-2">Showing 12 of {overwriteSamples.length} in the sample.</p>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPhase("field")}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setPhase("confirm")}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700"
            >
              Continue to confirm
            </button>
          </div>
        </div>
      )}

      {phase === "confirm" && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
          <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Step 3 — Confirm</p>
          <p className="text-sm text-gray-700">
            You are about to update{" "}
            <span className="font-semibold tabular-nums">{effectiveTotal.toLocaleString()}</span> card
            {effectiveTotal !== 1 ? "s" : ""}
            {trialLimit > 0 ? (
              <span className="text-amber-900 font-medium">
                {" "}
                (trial: first {Math.min(trialLimit, total)} of {total.toLocaleString()} in your list)
              </span>
            ) : (
              <span> in your saved list ({total.toLocaleString()} total).</span>
            )}
          </p>

          <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-sm text-sky-950 space-y-1">
            <label className="block text-xs font-semibold text-sky-900 uppercase tracking-wide">Trial run (optional)</label>
            <p className="text-xs text-sky-900/90">
              Apply to only the first few cards to validate the change before running the full list.
            </p>
            <select
              value={trialLimit}
              onChange={(e) => setTrialLimit(Number(e.target.value))}
              className="mt-1 border border-sky-200 rounded-lg px-2 py-1.5 text-sm bg-white max-w-xs"
            >
              <option value={0}>Full list ({total.toLocaleString()} cards)</option>
              <option value={3}>First 3 cards</option>
              <option value={5}>First 5 cards</option>
              <option value={10}>First 10 cards</option>
            </select>
          </div>

          {total > 0 && needsTypedCount && (
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-600">
                Type the card count to confirm ({total.toLocaleString()} cards in list)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={batchCountConfirm}
                onChange={(e) => setBatchCountConfirm(e.target.value)}
                placeholder={String(total)}
                className="w-full max-w-[12rem] border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums"
                autoComplete="off"
              />
              <p className="text-xs text-gray-500">Prevents accidental huge updates (full list size).</p>
            </div>
          )}

          {total > 0 && needsConfirm && (
            <label className="flex items-start gap-2 text-amber-900 text-sm">
              <input type="checkbox" className="mt-1 rounded" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
              <span>This will update more than {LARGE_THRESHOLD} cards. I intend to change this many cards.</span>
            </label>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPhase("review")}
              disabled={runBatch.isPending}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              disabled={
                runBatch.isPending ||
                total === 0 ||
                !typedCountOk ||
                (needsConfirm && !confirmLarge)
              }
              onClick={() => runBatch.mutate({})}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runBatch.isPending ? "Updating…" : `Apply to ${effectiveTotal.toLocaleString()} cards`}
            </button>
          </div>

          {batchProgress && batchProgress.total > 0 && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full bg-green-600 transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, (100 * batchProgress.done) / batchProgress.total)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 tabular-nums">
                {batchProgress.done.toLocaleString()} / {batchProgress.total.toLocaleString()} cards processed
              </p>
            </div>
          )}

          {runBatch.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {runBatch.error?.message || "Batch update failed."}
            </div>
          )}
        </div>
      )}

      {phase === "done" && runBatch.data && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
          <p className="text-xs font-semibold text-green-900 uppercase tracking-wide">Done</p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 space-y-2">
            <p>
              Updated <span className="font-semibold tabular-nums">{runBatch.data.updated}</span> card
              {runBatch.data.updated !== 1 ? "s" : ""}.
            </p>
            {runBatch.data.updated > 0 && (
              <p className="text-xs text-gray-600 pt-1">
                <Link
                  to={(() => {
                    const p = new URLSearchParams();
                    if (runBatch.data.batchRunSince) p.set("since", runBatch.data.batchRunSince);
                    if (runBatch.data.batchRunId) {
                      p.set("run", runBatch.data.batchRunId);
                    } else if (runBatch.data.batchFieldKey) {
                      p.set("field", runBatch.data.batchFieldKey);
                    }
                    p.set("mine", "1");
                    return `/history?${p.toString()}`;
                  })()}
                  className="text-green-700 font-medium underline hover:text-green-800"
                >
                  View these edits in history
                </Link>{" "}
                — filters to this run (or field), your edits, and from the start of this pass. Rows are still per card;
                use <strong>Batch runs</strong> on History to collapse by run.
              </p>
            )}
            {runBatch.data.errors.length > 0 && (
              <details className="text-amber-950 border border-amber-200/80 rounded-md bg-amber-50/50 px-2 py-1.5" open>
                <summary className="cursor-pointer font-medium">
                  {runBatch.data.errors.length} card{runBatch.data.errors.length !== 1 ? "s" : ""} not updated
                </summary>
                <div className="mt-2 max-h-56 overflow-y-auto text-xs space-y-3">
                  {BATCH_ERROR_BUCKET_ORDER.map((bucket) => {
                    const items = failedByBucket[bucket];
                    if (!items?.length) return null;
                    return (
                      <div key={bucket}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/80 mb-1">
                          {BATCH_ERROR_BUCKET_LABELS[bucket]}
                        </p>
                        <ul className="space-y-2">
                          {items.map((e) => {
                            const nm = errorNames[e.cardId];
                            const hint = batchErrorHint(e.message);
                            return (
                              <li key={e.cardId} className="border-b border-amber-100/80 pb-2 last:border-0 last:pb-0">
                                <div className="font-medium text-gray-900">
                                  {nm ? (
                                    <>
                                      <span>{nm}</span>
                                      <span className="text-gray-500 font-normal"> · </span>
                                    </>
                                  ) : null}
                                  <span className="font-mono text-gray-700">{e.cardId}</span>
                                </div>
                                <div className="text-amber-900/90 mt-0.5">{e.message}</div>
                                {hint ? <div className="text-gray-600 mt-1 pl-0.5 border-l-2 border-amber-200/80">{hint}</div> : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    onClick={retryFailed}
                    disabled={runBatch.isPending || failedIds.length === 0}
                    className="text-xs font-medium px-2 py-1 rounded border border-amber-300 bg-white text-amber-950 hover:bg-amber-50 disabled:opacity-40"
                  >
                    Retry failed only
                  </button>
                  <button
                    type="button"
                    onClick={copyFailedIds}
                    disabled={failedIds.length === 0}
                    className="text-xs font-medium px-2 py-1 rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Copy failed IDs
                  </button>
                </div>
              </details>
            )}
          </div>

          {batchProgress && batchProgress.total > 0 && runBatch.isPending && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full bg-green-600 transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, (100 * batchProgress.done) / batchProgress.total)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 tabular-nums">
                {batchProgress.done.toLocaleString()} / {batchProgress.total.toLocaleString()} cards processed
              </p>
            </div>
          )}

          <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-950 space-y-2">
            <p className="font-medium">Batch list</p>
            <p className="text-xs text-sky-900/90">Keep the same cards for another pass, or clear the list before your next selection.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  batchSelection.clear();
                  runBatch.reset();
                  setPhase("field");
                  toastSuccess("Batch list cleared.");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-sky-300 text-sky-950 hover:bg-sky-100/80"
              >
                Clear batch list
              </button>
              <button
                type="button"
                onClick={() => {
                  runBatch.reset();
                  setPhase("field");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700"
              >
                Keep list — new field
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
