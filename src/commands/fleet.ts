/**
 * Fleet command — one view of every agent run in the window: session,
 * project, model, duration, turns, subagents, cost, grade.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession, gradeLetterFromScore } from "../metrics/grader.js";
import { getCachedGrade, setCachedGrade } from "../cache/grade-cache.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import {
  formatDuration,
  projectNameFromSlug,
  shortSessionId,
} from "../utils/format.js";
import { VERSION } from "../version.js";
import type { GradeResult, SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;

export interface FleetRow {
  sessionId: string;
  projectSlug: string;
  model: string;
  startTime: string;
  mtime: string;
  durationMs: number;
  turnCount: number;
  subagentCount: number;
  costUsd: number | null;
  grade: GradeResult;
}

export interface FleetOptions {
  since?: string;
  limit?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

/** Collect graded fleet rows for a window. Shared by `fleet` and `report`. */
export async function collectFleet(options: {
  since: string;
  limit: number;
  dataDir?: string;
  project?: string;
}): Promise<FleetRow[]> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;

  const sessionFiles = (
    await scanSessions({ dataDir, project, since: parseDuration(options.since) })
  ).slice(0, options.limit);

  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(
      readJsonl(sf.path),
      sf.sessionId,
      sf.projectSlug,
      sf.subagentPaths,
    );
    let grade = getCachedGrade(sf.path, sf.mtime);
    if (!grade) {
      grade = gradeSession(session, config);
      setCachedGrade(sf.path, sf.mtime, grade);
    }
    const costMetric = grade.metrics.find((m) => m.name === "session-cost");
    return {
      sessionId: session.id,
      projectSlug: session.projectSlug,
      model: session.model,
      startTime: session.startTime,
      mtime: sf.mtime.toISOString(),
      durationMs: session.durationMs,
      turnCount: session.turns.length,
      subagentCount: session.subagentCount,
      costUsd: costMetric?.value ?? null,
      grade,
    } satisfies FleetRow;
  });

  return settled
    .filter((r): r is PromiseFulfilledResult<FleetRow> => r.status === "fulfilled")
    .map((r) => r.value);
}

export async function runFleet(options: FleetOptions): Promise<void> {
  const since = options.since ?? "7d";
  const rows = await collectFleet({
    since,
    limit: Number(options.limit ?? 50),
    dataDir: options.dataDir,
    project: options.project,
  });

  if (rows.length === 0) {
    console.log(`No sessions found in the last ${since}.`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold(`  inspecto v${VERSION}`) + chalk.dim(" — Fleet view"));
  lines.push("");

  const table = new Table({
    head: ["Session", "Project", "Model", "Duration", "Turns", "Agents", "Cost", "Grade"].map(
      (h) => chalk.bold(h),
    ),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push([
      shortSessionId(row.sessionId),
      projectNameFromSlug(row.projectSlug),
      shortModel(row.model),
      formatDuration(row.durationMs),
      String(row.turnCount),
      row.subagentCount > 0 ? String(row.subagentCount) : chalk.dim("—"),
      row.costUsd !== null ? `$${row.costUsd.toFixed(2)}` : chalk.dim("—"),
      colorGrade(row.grade.letter),
    ]);
  }
  lines.push(
    table
      .toString()
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  const totalCost = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const avgScore = rows.reduce((sum, r) => sum + r.grade.score, 0) / rows.length;
  lines.push("");
  lines.push(
    `  ${rows.length} sessions | total cost $${totalCost.toFixed(2)} | avg grade ` +
      colorGrade(letterFor(avgScore)) +
      chalk.dim(` (${Math.round(avgScore)})`),
  );
  lines.push("");
  console.log(lines.join("\n"));
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function letterFor(score: number): string {
  return gradeLetterFromScore(score);
}

function colorGrade(letter: string): string {
  if (letter.startsWith("A")) return chalk.green(letter);
  if (letter.startsWith("B")) return chalk.cyan(letter);
  if (letter.startsWith("C")) return chalk.yellow(letter);
  return chalk.red(letter);
}
