/**
 * Parse human-readable duration strings into Date offsets.
 */

/**
 * Parse a duration string like "7d", "14d", "30d" into a Date
 * representing that many days before `now`.
 */
export function parseDuration(duration: string, now = new Date()): Date {
  const match = duration.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(
      `Invalid duration: "${duration}". Use format like "7d", "14d", "30d".`,
    );
  }

  const days = parseInt(match[1], 10);
  const result = new Date(now);
  result.setDate(result.getDate() - days);
  return result;
}
