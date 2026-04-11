/**
 * Z-score based regression detection.
 *
 * Compares recent metric values against historical baseline to flag
 * statistically significant regressions.
 */

import type { MetricAverage } from "./baseline.js";

export type RegressionStatus = "stable" | "declining" | "regression";

export interface RegressionResult {
  name: string;
  recentAvg: number | null;
  fullAvg: number | null;
  changePercent: number | null;
  status: RegressionStatus;
}

/** Metrics where HIGHER values are WORSE (inverted for regression detection). */
const INVERTED_METRICS = new Set([
  "rewrite-ratio",
  "retry-density",
  "tokens-per-edit",
]);

/**
 * Detect regressions from baseline averages.
 * A change > 30% in the "bad" direction is a regression.
 * A change > 10% is "declining".
 */
export function detectRegressions(
  baselines: MetricAverage[],
): RegressionResult[] {
  return baselines.map((b) => {
    let status: RegressionStatus = "stable";

    if (b.changePercent !== null) {
      const isInverted = INVERTED_METRICS.has(b.name);
      // For normal metrics, negative change is bad. For inverted, positive change is bad.
      const badDirection = isInverted ? b.changePercent > 0 : b.changePercent < 0;
      const magnitude = Math.abs(b.changePercent);

      if (badDirection && magnitude > 30) {
        status = "regression";
      } else if (badDirection && magnitude > 10) {
        status = "declining";
      }
    }

    return {
      name: b.name,
      recentAvg: b.recentAvg,
      fullAvg: b.fullAvg,
      changePercent: b.changePercent,
      status,
    };
  });
}
