/**
 * Shared copy for card attribution (Explore detail line + grid tooltip).
 */

export function formatRelativeUpdatedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, "day");
  const diffWeek = Math.round(diffDay / 7);
  if (Math.abs(diffWeek) < 5) return rtf.format(diffWeek, "week");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
  return rtf.format(Math.round(diffDay / 365), "year");
}

export function labelForUser(displayName, userId) {
  const n = displayName && String(displayName).trim();
  if (n) return n;
  if (userId) return `…${String(userId).replace(/-/g, "").slice(-8)}`;
  return "Unknown";
}

/**
 * Plain-text one-liner for native `title` tooltips (grid). Returns null when nothing to show.
 */
export function buildCardAttributionPlainText({
  createdById,
  creatorDisplayName,
  annotationUpdatedById,
  annotationUpdatedByName,
  annotationUpdatedAt,
}) {
  const hasCreator = Boolean(createdById);
  const hasAnnEdit = Boolean(annotationUpdatedAt || annotationUpdatedById);
  if (!hasCreator && !hasAnnEdit) return null;

  const parts = [];
  if (hasCreator) {
    parts.push(`Added by ${labelForUser(creatorDisplayName, createdById)}`);
  }
  if (hasAnnEdit) {
    const rel = annotationUpdatedAt ? formatRelativeUpdatedAt(annotationUpdatedAt) : null;
    let s = "Annotations";
    if (rel) s += ` updated ${rel}`;
    if (annotationUpdatedById) {
      s += ` by ${labelForUser(annotationUpdatedByName, annotationUpdatedById)}`;
    }
    parts.push(s);
  }
  return parts.join(" · ");
}
