/**
 * Number and string formatting helpers for terminal output.
 */

/** Format a number with comma separators: 3218 → "3,218" */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format a ratio as a fixed-2 decimal: 0.734 → "0.73" */
export function formatRatio(n: number): string {
  return n.toFixed(2);
}

/** Format a percentage: 0.734 → "73%" */
export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Format milliseconds into a human-readable duration: 2820000 → "47 min" */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

/** Truncate a session ID for display: "31f3f224-abcd-..." → "31f3f224" */
export function shortSessionId(id: string): string {
  return id.slice(0, 8);
}

/** Extract a human-readable project name from a slug like "-Users-foo-my-app" */
export function projectNameFromSlug(slug: string): string {
  const parts = slug.split("-").filter(Boolean);
  return parts[parts.length - 1] || slug;
}
