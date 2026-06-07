/**
 * Trend analysis command — detect regressions over time.
 */

import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { computeBaselines } from "../anomaly/baseline.js";
import { detectRegressions } from "../anomaly/regression-detector.js";
import { renderTrendReport } from "../reporter/terminal.js";
import { formatTrendJson } from "../reporter/json-reporter.js";
import { parseDuration } from "../utils/duration.js";
import type { GradeResult } from "../parser/types.js";

export interface TrendOptions {
  since?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runTrend(options: TrendOptions): Promise<void> {
  const duration = options.since ?? "7d";
  const sinceDate = parseDuration(duration);

  const sessionFiles = await scanSessions({
    dataDir: options.dataDir,
    project: options.project,
    since: sinceDate,
  });

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in the last ${duration}.`);
    return;
  }

  const settled = await Promise.allSettled(
    sessionFiles.map(async (sf) => {
      const records = readJsonl(sf.path);
      const session = await buildSession(records, sf.sessionId, sf.projectSlug);
      return gradeSession(session);
    }),
  );
  const grades: GradeResult[] = settled
    .filter((r): r is PromiseFulfilledResult<GradeResult> => r.status === "fulfilled")
    .map((r) => r.value);

  if (grades.length === 0) {
    console.log("No valid sessions found to analyze.");
    return;
  }

  // Use half the sessions as the "recent" window, minimum 1
  const recentCount = Math.max(1, Math.floor(grades.length / 2));
  const baselines = computeBaselines(grades, recentCount);
  const regressions = detectRegressions(baselines);

  if (options.json) {
    console.log(formatTrendJson(regressions));
  } else {
    console.log(renderTrendReport(regressions, grades.length, duration));
  }
}
