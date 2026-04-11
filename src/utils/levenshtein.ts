/**
 * Levenshtein distance and normalized similarity.
 * Pure implementation — no external dependencies.
 */

/**
 * Compute the Levenshtein edit distance between two strings.
 * Uses a single-row DP approach for O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) [a, b] = [b, a];

  const aLen = a.length;
  const bLen = b.length;
  const row = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0];
    row[0] = j;

    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const temp = row[i];
      row[i] = Math.min(
        row[i] + 1,       // deletion
        row[i - 1] + 1,   // insertion
        prev + cost,       // substitution
      );
      prev = temp;
    }
  }

  return row[aLen];
}

/**
 * Compute normalized similarity between two strings (0 = different, 1 = identical).
 * Only compares the first `maxLen` characters for performance.
 */
export function normalizedSimilarity(
  a: string,
  b: string,
  maxLen = 200,
): number {
  const aTrunc = a.slice(0, maxLen);
  const bTrunc = b.slice(0, maxLen);
  const maxLength = Math.max(aTrunc.length, bTrunc.length);

  if (maxLength === 0) return 1;

  const distance = levenshteinDistance(aTrunc, bTrunc);
  return 1 - distance / maxLength;
}
