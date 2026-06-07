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
import { exportTrendCsv } from "../reporter/csv-reporter.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { getCachedGrade, setCachedGrade } from "../cache/grade-cache.js";
import { loadConfig } from "../config/loader.js";
import type { GradeResult, SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;

export interface TrendOptions {
  since?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
  /** false when --no-fail is passed; defaults to true via Commander */
  fail?: boolean;
  format?: string;
}

export async function runTrend(options: TrendOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;

  const duration = options.since ?? "7d";
  const sinceDate = parseDuration(duration);

  const sessionFiles = await scanSessions({ dataDir, project, since: sinceDate });

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in the last ${duration}.`);
    return;
  }

  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const cached = getCachedGrade(sf.path, sf.mtime);
    if (cached) return cached;
    const records = readJsonl(sf.path);
    const session = await buildSession(records, sf.sessionId, sf.projectSlug, sf.subagentPaths);
    const grade = gradeSession(session, config);
    setCachedGrade(sf.path, sf.mtime, grade);
    return grade;
  });

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

  if (options.json || options.format === "json") {
    console.log(formatTrendJson(regressions));
  } else if (options.format === "csv") {
    console.log(exportTrendCsv(regressions));
  } else {
    console.log(renderTrendReport(regressions, grades.length, duration));
  }

  if (options.fail !== false && regressions.some((r) => r.status === "regression")) {
    process.exitCode = 1;
  }
}
