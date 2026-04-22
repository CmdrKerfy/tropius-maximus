const HISTORY_FIELD_LABELS = {
  card_name: "Card name (rename)",
};

export function formatHistoryFieldLabel(fieldName) {
  const key = String(fieldName || "").trim();
  if (!key) return "—";
  return HISTORY_FIELD_LABELS[key] || key;
}
