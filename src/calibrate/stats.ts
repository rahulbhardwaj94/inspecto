/**
 * Correlation statistics for metric calibration.
 *
 * Pure functions with no dependencies — the credibility of `inspecto calibrate`
 * rests entirely on these being correct, so they are unit-tested against known
 * values.
 */

/** Pearson product-moment correlation. Null when undefined (n < 2 or zero variance). */
export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n !== y.length || n < 2) return null;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denominator = Math.sqrt(varX * varY);
  if (denominator === 0) return null; // one series is constant
  return numerator / denominator;
}

/**
 * Fractional ranks with ties averaged: [10, 20, 20, 30] → [1, 2.5, 2.5, 4].
 */
export function rank(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++;
    // Ranks are 1-based; average the span for ties.
    const averageRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation — robust to outliers and monotonic-but-nonlinear
 * relationships, which is the common case for these metrics.
 */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  return pearson(rank(x), rank(y));
}
