/**
 * Metric calibration: does each quality metric actually predict outcomes?
 *
 * The 12 metrics encode assumptions about what good agent behaviour looks like.
 * The outcome layer (survival of edited lines, cost per landed commit) lets those
 * assumptions be TESTED against what really happened to the code. A metric that
 * fires constantly but shows no relationship to outcomes is a false alarm, and
 * this is what surfaces it.
 *
 * Correlations from a single developer's history are suggestive, never proof —
 * `n` is reported everywhere and verdicts are withheld below MIN_SAMPLES.
 */

import { pearson, spearman } from "./stats.js";
import type { MetricResult } from "../parser/types.js";

/** Below this many paired observations, no verdict is offered. */
export const MIN_SAMPLES = 8;

/** Direction each metric assumes is "better", mirroring the grader's scoring. */
const HIGHER_IS_BETTER: Record<string, boolean> = {
  "reads-per-edit": true,
  "cache-hit-rate": true,
  "task-completion": true,
  "tool-diversity": true,
  "thinking-utilization": true,
  "rewrite-ratio": false,
  "retry-density": false,
  "tokens-per-edit": false,
  "subagent-overhead": false,
  "tool-error-rate": false,
  "session-cost": false,
};

export type Verdict =
  | "predictive"
  | "weak"
  | "no-signal"
  | "false-alarm"
  | "insufficient-data"
  | "informational";

export interface OutcomeSample {
  metrics: MetricResult[];
  /** Fraction of the session's added lines still alive at HEAD. */
  survivalRate: number | null;
  /** Session cost divided by commits it landed. */
  costPerCommit: number | null;
}

export interface MetricCalibration {
  name: string;
  /** Paired observations available for the survival correlation. */
  n: number;
  survivalPearson: number | null;
  survivalSpearman: number | null;
  costPerCommitSpearman: number | null;
  /** Fraction of ALL sessions where this metric was warning or critical. */
  firesRate: number;
  /** True when the metric moves the way the grader assumes it should. */
  directionMatchesTheory: boolean | null;
  verdict: Verdict;
}

export interface CalibrationReport {
  sessionsAnalyzed: number;
  sessionsWithOutcomes: number;
  metrics: MetricCalibration[];
}

export function calibrate(samples: OutcomeSample[]): CalibrationReport {
  const withOutcomes = samples.filter((s) => s.survivalRate !== null);
  const names = [...new Set(samples.flatMap((s) => s.metrics.map((m) => m.name)))];

  const metrics = names.map((name) => {
    // Fires rate is measured across every session, not just linked ones.
    const statuses = samples
      .map((s) => s.metrics.find((m) => m.name === name))
      .filter((m): m is MetricResult => m !== undefined);
    const firesRate = statuses.length
      ? statuses.filter((m) => m.status !== "healthy").length / statuses.length
      : 0;

    const survivalPairs = pairs(withOutcomes, name, (s) => s.survivalRate);
    const costPairs = pairs(withOutcomes, name, (s) => s.costPerCommit);

    const survivalSpearman = spearman(survivalPairs.x, survivalPairs.y);
    const calibration: MetricCalibration = {
      name,
      n: survivalPairs.x.length,
      survivalPearson: pearson(survivalPairs.x, survivalPairs.y),
      survivalSpearman,
      costPerCommitSpearman: spearman(costPairs.x, costPairs.y),
      firesRate,
      directionMatchesTheory: directionMatches(name, survivalSpearman),
      verdict: "insufficient-data",
    };
    calibration.verdict = verdictFor(name, calibration);
    return calibration;
  });

  return {
    sessionsAnalyzed: samples.length,
    sessionsWithOutcomes: withOutcomes.length,
    metrics,
  };
}

// ---------------------------------------------------------------------------

/** Metric value paired with an outcome value, dropping incomplete observations. */
function pairs(
  samples: OutcomeSample[],
  name: string,
  outcome: (s: OutcomeSample) => number | null,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const sample of samples) {
    const metric = sample.metrics.find((m) => m.name === name);
    const outcomeValue = outcome(sample);
    if (!metric || metric.value === null || outcomeValue === null) continue;
    x.push(metric.value);
    y.push(outcomeValue);
  }
  return { x, y };
}

/**
 * Does the observed correlation point the way the grader assumes? A metric the
 * grader treats as "higher is better" should correlate positively with survival.
 */
function directionMatches(name: string, survivalCorrelation: number | null): boolean | null {
  const higherIsBetter = HIGHER_IS_BETTER[name];
  if (higherIsBetter === undefined || survivalCorrelation === null) return null;
  if (survivalCorrelation === 0) return null;
  return higherIsBetter ? survivalCorrelation > 0 : survivalCorrelation < 0;
}

function verdictFor(name: string, c: MetricCalibration): Verdict {
  if (HIGHER_IS_BETTER[name] === undefined) return "informational";
  if (c.n < MIN_SAMPLES || c.survivalSpearman === null) return "insufficient-data";

  const strength = Math.abs(c.survivalSpearman);
  if (strength >= 0.5) return "predictive";
  if (strength >= 0.3) return "weak";
  // No relationship to outcomes, yet flagging most sessions — the costly case.
  if (c.firesRate >= 0.5) return "false-alarm";
  return "no-signal";
}
