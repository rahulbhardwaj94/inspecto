/**
 * Privacy-safe history export for team baselines.
 *
 * The export contains pseudonymous session/project labels and computed metrics
 * only. It deliberately excludes paths, prompts, tool inputs/results, source
 * code, git branches, user names, and raw session identifiers.
 */

import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { loadConfig } from "../config/loader.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { exportMetricsOnlyCsv } from "../reporter/csv-reporter.js";
import type { GradeResult, Session, SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;

export interface ExportMetricsOptions {
  since?: string;
  dataDir?: string;
  project?: string;
  format?: string;
}

export interface MetricsOnlyRow {
  schemaVersion: 1;
  session: string;
  period: string;
  project: string;
  model: string;
  grade: string;
  score: number;
  metrics: Record<string, number | null>;
}

export interface AnalyzedSession {
  file: SessionFile;
  session: Session;
  grade: GradeResult;
}

export async function runExportMetrics(options: ExportMetricsOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const duration = options.since ?? "30d";
  const since = parseDuration(duration);
  const files = await scanSessions({ dataDir, project, since });

  if (files.length === 0) {
    throw new Error(`No sessions found in the last ${duration}.`);
  }

  const settled = await concurrentSettled(files, CONCURRENCY, async (file) => {
    const records = readJsonl(file.path);
    const session = await buildSession(
      records,
      file.sessionId,
      file.projectSlug,
      file.subagentPaths,
    );
    return { file, session, grade: gradeSession(session, config) } satisfies AnalyzedSession;
  });

  const analyzed = settled
    .filter((result): result is PromiseFulfilledResult<AnalyzedSession> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => sessionTime(a).getTime() - sessionTime(b).getTime());

  if (analyzed.length === 0) {
    throw new Error("No valid sessions found to export.");
  }

  const rows = createMetricsOnlyRows(analyzed);
  if (options.format === "json") {
    console.log(JSON.stringify({
      schemaVersion: 1,
      window: duration,
      sessionCount: rows.length,
      skippedSessionCount: files.length - rows.length,
      rows,
    }, null, 2));
  } else {
    console.log(exportMetricsOnlyCsv(rows));
  }
}

export function createMetricsOnlyRows(analyzed: AnalyzedSession[]): MetricsOnlyRow[] {
  const projectLabels = new Map<string, string>();
  const oldest = sessionTime(analyzed[0]).getTime();

  return analyzed.map(({ file, session, grade }, index) => {
    let project = projectLabels.get(file.projectSlug);
    if (!project) {
      project = `project-${projectLabels.size + 1}`;
      projectLabels.set(file.projectSlug, project);
    }

    const elapsedWeeks = Math.max(
      0,
      Math.floor((sessionTime({ file, session }).getTime() - oldest) / (7 * 24 * 60 * 60 * 1000)),
    );

    return {
      schemaVersion: 1,
      session: `session-${String(index + 1).padStart(3, "0")}`,
      period: `week-${elapsedWeeks + 1}`,
      project,
      model: session.model || "unknown",
      grade: grade.letter,
      score: grade.score,
      metrics: Object.fromEntries(grade.metrics.map((metric) => [metric.name, metric.value])),
    };
  });
}

function sessionTime(entry: Pick<AnalyzedSession, "file" | "session">): Date {
  const parsed = Date.parse(entry.session.startTime);
  return Number.isFinite(parsed) ? new Date(parsed) : entry.file.mtime;
}
