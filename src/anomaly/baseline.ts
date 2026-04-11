/**
 * Compute rolling averages from multiple sessions for trend analysis.
 */

import type { GradeResult } from "../parser/types.js";

export interface MetricAverage {
  name: string;
  recentAvg: number | null;
  fullAvg: number | null;
  changePercent: number | null;
}

/**
 * Compute per-metric averages for a recent window vs. full range.
 * @param grades - All graded sessions, sorted most recent first
 * @param recentCount - Number of sessions in the "recent" window
 */
export function computeBaselines(
  grades: GradeResult[],
  recentCount: number,
): MetricAverage[] {
  if (grades.length === 0) return [];

  const recent = grades.slice(0, recentCount);
  const full = grades;

  const metricNames = grades[0].metrics.map((m) => m.name);

  return metricNames.map((name) => {
    const recentValues = extractValues(recent, name);
    const fullValues = extractValues(full, name);

    const recentAvg = average(recentValues);
    const fullAvg = average(fullValues);

    let changePercent: number | null = null;
    if (recentAvg !== null && fullAvg !== null && fullAvg !== 0) {
      changePercent = ((recentAvg - fullAvg) / Math.abs(fullAvg)) * 100;
    }

    return { name, recentAvg, fullAvg, changePercent };
  });
}

function extractValues(grades: GradeResult[], metricName: string): number[] {
  const values: number[] = [];
  for (const grade of grades) {
    const metric = grade.metrics.find((m) => m.name === metricName);
    if (metric?.value !== null && metric?.value !== undefined) {
      values.push(metric.value);
    }
  }
  return values;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
