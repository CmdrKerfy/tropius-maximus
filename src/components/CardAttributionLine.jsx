/**
 * Muted one-line attribution for Explore card detail (Supabase only).
 */
import { Link } from "react-router-dom";
import { useSupabaseBackend } from "../db";
import { formatRelativeUpdatedAt, labelForUser } from "../lib/cardAttributionSummary.js";

function ProfileNameLink({ userId, displayName }) {
  const label = labelForUser(displayName, userId);
  if (!userId) return <span>{label}</span>;
  return (
    <Link
      to={`/profile/${encodeURIComponent(userId)}`}
      className="text-gray-500 hover:text-gray-700 no-underline hover:underline decoration-gray-400"
    >
      {label}
    </Link>
  );
}

export default function CardAttributionLine({
  createdById,
  creatorDisplayName,
  annotationUpdatedById,
  annotationUpdatedByName,
  annotationUpdatedAt,
}) {
  if (!useSupabaseBackend()) return null;

  const hasCreator = Boolean(createdById);
  const hasAnnEdit = Boolean(annotationUpdatedAt || annotationUpdatedById);
  if (!hasCreator && !hasAnnEdit) return null;

  const rel = annotationUpdatedAt ? formatRelativeUpdatedAt(annotationUpdatedAt) : null;
  const nodes = [];

  if (hasCreator) {
    nodes.push(
      <span key="added">
        Added by{" "}
        <ProfileNameLink userId={createdById} displayName={creatorDisplayName} />
      </span>
    );
  }

  if (hasAnnEdit) {
    if (nodes.length) nodes.push(<span key="dot"> · </span>);
    nodes.push(
      <span key="ann">
        Annotations
        {rel ? <> updated {rel}</> : null}
        {annotationUpdatedById ? (
          <>
            {" "}
            by{" "}
            <ProfileNameLink
              userId={annotationUpdatedById}
              displayName={annotationUpdatedByName}
            />
          </>
        ) : null}
      </span>
    );
  }

  return <p className="text-[11px] text-gray-400 mt-1 leading-snug">{nodes}</p>;
}
