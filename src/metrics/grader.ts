/**
 * Composite grading from all 8 quality metrics.
 *
 * Each metric is scored 0-100 based on its thresholds, then weighted
 * into a composite score mapped to a letter grade A+ through F.
 */

import type { GradeResult, MetricResult, Session } from "../parser/types.js";
import { computeReadsPerEdit } from "./reads-per-edit.js";
import { computeRewriteRatio } from "./rewrite-ratio.js";
import { computeCacheHitRate } from "./cache-hit-rate.js";
import { computeTaskCompletion } from "./task-completion.js";
import { computeRetryDensity } from "./retry-density.js";
import { computeToolDiversity } from "./tool-diversity.js";
import { computeTokensPerEdit } from "./tokens-per-edit.js";
import { computeSubagentOverhead } from "./subagent-overhead.js";

interface MetricWeight {
  compute: (session: Session) => MetricResult;
  weight: number;
  /** Convert metric value to 0-100 score. Higher is better. */
  score: (value: number) => number;
}

const METRIC_WEIGHTS: MetricWeight[] = [
  {
    compute: computeReadsPerEdit,
    weight: 0.2,
    // 0 reads → 0, 2 reads → 50, 4+ reads → 100
    score: (v) => clamp(v / 4 * 100, 0, 100),
  },
  {
    compute: computeRewriteRatio,
    weight: 0.15,
    // 0 ratio → 100, 0.25 → 50, 0.5+ → 0 (inverted: lower is better)
    score: (v) => clamp((1 - v / 0.5) * 100, 0, 100),
  },
  {
    compute: computeCacheHitRate,
    weight: 0.15,
    // 0% → 0, 50% → 100
    score: (v) => clamp(v / 0.5 * 100, 0, 100),
  },
  {
    compute: computeTaskCompletion,
    weight: 0.15,
    // 0.7 → 0, 0.9 → 50, 1.0 → 100
    score: (v) => clamp((v - 0.7) / 0.3 * 100, 0, 100),
  },
  {
    compute: computeRetryDensity,
    weight: 0.1,
    // 0% → 100, 10% → 60, 25%+ → 0 (inverted)
    score: (v) => clamp((1 - v / 0.25) * 100, 0, 100),
  },
  {
    compute: computeToolDiversity,
    weight: 0.05,
    // 0 → 0, 0.4 → 50, 0.6+ → 100
    score: (v) => clamp(v / 0.6 * 100, 0, 100),
  },
  {
    compute: computeTokensPerEdit,
    weight: 0.15,
    // 5000 → 100, 10000 → 50, 15000+ → 0 (inverted)
    score: (v) => clamp((1 - (v - 5000) / 10000) * 100, 0, 100),
  },
  {
    compute: computeSubagentOverhead,
    weight: 0.05,
    // main ratio 0 → 100, 0.6 → 100 (threshold), 0.8 → 50, 1.0 → 0 (inverted)
    score: (v) => clamp((1 - v) / 0.4 * 100, 0, 100),
  },
];

const GRADE_THRESHOLDS: Array<[number, string]> = [
  [97, "A+"],
  [93, "A"],
  [90, "A-"],
  [87, "B+"],
  [83, "B"],
  [80, "B-"],
  [77, "C+"],
  [73, "C"],
  [70, "C-"],
  [67, "D+"],
  [63, "D"],
  [60, "D-"],
  [0, "F"],
];

export function gradeSession(session: Session): GradeResult {
  const metrics: MetricResult[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const mw of METRIC_WEIGHTS) {
    const result = mw.compute(session);
    metrics.push(result);

    if (result.value !== null) {
      weightedSum += mw.score(result.value) * mw.weight;
      totalWeight += mw.weight;
    }
  }

  // Normalize if some metrics returned null (insufficient data)
  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const letter =
    GRADE_THRESHOLDS.find(([threshold]) => compositeScore >= threshold)?.[1] ?? "F";

  return {
    letter,
    score: Math.round(compositeScore),
    metrics,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
