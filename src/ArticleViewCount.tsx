import { Eye } from "lucide-react";

/** Displays a normalized public article view total without exposing visit details. */
export function ArticleViewCount(props: { count: number }) {
  const count = Number.isFinite(props.count) ? Math.max(0, Math.floor(props.count)) : 0; // Stable non-negative total shown to visitors.
  const label = `${count} 次浏览`; // Shared visible text and hover description.

  return (
    <span className="article-view-count" title={label}>
      <Eye size={15} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
