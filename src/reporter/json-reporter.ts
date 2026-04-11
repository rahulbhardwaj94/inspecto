/**
 * JSON output mode for scripting and CI.
 */

import type { GradeResult, Session } from "../parser/types.js";
import type { RegressionResult } from "../anomaly/regression-detector.js";
import type { CacheCheckResult } from "../anomaly/cache-anomaly.js";

export interface AuditJsonOutput {
  session: {
    id: string;
    project: string;
    model: string;
    durationMs: number;
    startTime: string;
  };
  grade: string;
  score: number;
  metrics: Array<{
    name: string;
    value: number | null;
    status: string;
    label: string;
  }>;
}

export function formatAuditJson(session: Session, grade: GradeResult): string {
  const output: AuditJsonOutput = {
    session: {
      id: session.id,
      project: session.projectSlug,
      model: session.model,
      durationMs: session.durationMs,
      startTime: session.startTime,
    },
    grade: grade.letter,
    score: grade.score,
    metrics: grade.metrics.map((m) => ({
      name: m.name,
      value: m.value,
      status: m.status,
      label: m.label,
    })),
  };

  return JSON.stringify(output, null, 2);
}

export function formatTrendJson(results: RegressionResult[]): string {
  return JSON.stringify({ trend: results }, null, 2);
}

export function formatCacheCheckJson(results: CacheCheckResult[]): string {
  return JSON.stringify({ cacheCheck: results }, null, 2);
}
