/**
 * Composite grading from all 8 quality metrics.
 *
 * Each metric is scored 0-100 based on its thresholds, then weighted
 * into a composite score mapped to a letter grade A+ through F.
 */

import type { GradeResult, MetricResult, Session } from "../parser/types.js";
import type { InspectoConfig } from "../config/types.js";
import { computeReadsPerEdit } from "./reads-per-edit.js";
import { computeRewriteRatio } from "./rewrite-ratio.js";
import { computeCacheHitRate } from "./cache-hit-rate.js";
import { computeTaskCompletion } from "./task-completion.js";
import { computeRetryDensity } from "./retry-density.js";
import { computeToolDiversity } from "./tool-diversity.js";
import { computeTokensPerEdit } from "./tokens-per-edit.js";
import { computeSubagentOverhead } from "./subagent-overhead.js";
import { computeToolErrorRate } from "./tool-error-rate.js";
import { computeThinkingUtilization } from "./thinking-utilization.js";
import { computeMcpUsage } from "./mcp-usage.js";
import { computeSessionCost } from "./session-cost.js";

interface MetricWeight {
  compute: (session: Session) => MetricResult;
  weight: number;
  /** Convert metric value to 0-100 score. Higher is better. */
  score: (value: number) => number;
}

function buildMetricWeights(config?: InspectoConfig): MetricWeight[] {
  const t = config?.thresholds ?? {};
  const w = config?.weights ?? {};

  return [
    {
      compute: (session) => computeReadsPerEdit(session, t.readsPerEdit),
      weight: w.readsPerEdit ?? 0.14,
      // 0 reads → 0, 2 reads → 50, 4+ reads → 100
      score: (v) => clamp(v / 4 * 100, 0, 100),
    },
    {
      compute: (session) => computeRewriteRatio(session, t.rewriteRatio),
      weight: w.rewriteRatio ?? 0.11,
      // 0 ratio → 100, 0.25 → 50, 0.5+ → 0 (inverted: lower is better)
      score: (v) => clamp((1 - v / 0.5) * 100, 0, 100),
    },
    {
      compute: (session) => computeCacheHitRate(session, t.cacheHitRate),
      weight: w.cacheHitRate ?? 0.11,
      // 0% → 0, 50% → 100
      score: (v) => clamp(v / 0.5 * 100, 0, 100),
    },
    {
      compute: (session) => computeTaskCompletion(session, t.taskCompletion),
      weight: w.taskCompletion ?? 0.10,
      // 0.7 → 0, 0.9 → 50, 1.0 → 100
      score: (v) => clamp((v - 0.7) / 0.3 * 100, 0, 100),
    },
    {
      compute: (session) => computeRetryDensity(session, t.retryDensity),
      weight: w.retryDensity ?? 0.07,
      // 0% → 100, 10% → 60, 25%+ → 0 (inverted)
      score: (v) => clamp((1 - v / 0.25) * 100, 0, 100),
    },
    {
      compute: (session) => computeToolDiversity(session, t.toolDiversity),
      weight: w.toolDiversity ?? 0.06,
      // 0 → 0, 0.4 → 50, 0.6+ → 100
      score: (v) => clamp(v / 0.6 * 100, 0, 100),
    },
    {
      compute: (session) => computeTokensPerEdit(session, t.tokensPerEdit),
      weight: w.tokensPerEdit ?? 0.11,
      // 5000 → 100, 10000 → 50, 15000+ → 0 (inverted)
      score: (v) => clamp((1 - (v - 5000) / 10000) * 100, 0, 100),
    },
    {
      compute: computeSubagentOverhead,
      weight: 0.05,
      // main ratio 0 → 100, 0.6 → 100 (threshold), 0.8 → 50, 1.0 → 0 (inverted)
      score: (v) => clamp((1 - v) / 0.4 * 100, 0, 100),
    },
    {
      compute: computeToolErrorRate,
      weight: 0.08,
      // 0% → 100, 5% → 83, 15% → 50, 30%+ → 0 (inverted: lower is better)
      score: (v) => clamp((1 - v / 0.30) * 100, 0, 100),
    },
    {
      compute: computeThinkingUtilization,
      weight: 0.07,
      // 0% → 0, 10% → 33, 30%+ → 100
      score: (v) => clamp(v / 0.30 * 100, 0, 100),
    },
    {
      compute: computeMcpUsage,
      weight: 0.05,
      // Informational: always contributes max score
      score: (_v) => 100,
    },
    {
      compute: (session) => computeSessionCost(session, t.sessionCost),
      weight: 0.05,
      // $0 → 100, $5 → 50, $10+ → 0 (inverted: lower cost is better)
      score: (v) => clamp((1 - v / 10) * 100, 0, 100),
    },
  ];
}

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

export function gradeLetterFromScore(score: number): string {
  return GRADE_THRESHOLDS.find(([threshold]) => score >= threshold)?.[1] ?? "F";
}

export function gradeSession(session: Session, config?: InspectoConfig): GradeResult {
  const metricWeights = buildMetricWeights(config);
  const metrics: MetricResult[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const mw of metricWeights) {
    const result = mw.compute(session);
    metrics.push(result);

    if (result.value !== null) {
      weightedSum += mw.score(result.value) * mw.weight;
      totalWeight += mw.weight;
    }
  }

  // Normalize if some metrics returned null (insufficient data)
  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const letter = gradeLetterFromScore(compositeScore);

  return {
    letter,
    score: Math.round(compositeScore),
    metrics,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
