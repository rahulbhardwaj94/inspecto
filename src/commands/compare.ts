/**
 * Cross-project comparison command.
 * Compares average quality metrics across multiple projects.
 */

import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import chalk from "chalk";
import Table from "cli-table3";
import type { GradeResult } from "../parser/types.js";
import { projectNameFromSlug } from "../utils/format.js";

export interface CompareOptions {
  projects: string;
  json?: boolean;
  dataDir?: string;
  since?: string;
}

interface ProjectSummary {
  name: string;
  sessionCount: number;
  avgGrade: number;
  avgLetter: string;
  metrics: Map<string, number>;
}

export async function runCompare(options: CompareOptions): Promise<void> {
  const projectNames = options.projects.split(",").map((p) => p.trim());
  const summaries: ProjectSummary[] = [];

  for (const projectFilter of projectNames) {
    const sessionFiles = await scanSessions({
      dataDir: options.dataDir,
      project: projectFilter,
    });

    if (sessionFiles.length === 0) continue;

    const grades: GradeResult[] = [];
    for (const sf of sessionFiles) {
      try {
        const records = readJsonl(sf.path);
        const session = await buildSession(records, sf.sessionId, sf.projectSlug);
        grades.push(gradeSession(session));
      } catch {
        continue;
      }
    }

    if (grades.length === 0) continue;

    const avgScore = grades.reduce((s, g) => s + g.score, 0) / grades.length;
    const metricAvgs = new Map<string, number>();
    for (const metric of grades[0].metrics) {
      const values = grades
        .map((g) => g.metrics.find((m) => m.name === metric.name)?.value)
        .filter((v): v is number => v !== null);
      if (values.length > 0) {
        metricAvgs.set(metric.name, values.reduce((a, b) => a + b, 0) / values.length);
      }
    }

    summaries.push({
      name: projectFilter,
      sessionCount: grades.length,
      avgGrade: Math.round(avgScore),
      avgLetter: getLetterGrade(avgScore),
      metrics: metricAvgs,
    });
  }

  if (summaries.length === 0) {
    console.log("No matching projects found.");
    return;
  }

  if (options.json) {
    const jsonOutput = summaries.map((s) => ({
      project: s.name,
      sessions: s.sessionCount,
      grade: s.avgLetter,
      score: s.avgGrade,
      metrics: Object.fromEntries(s.metrics),
    }));
    console.log(JSON.stringify({ compare: jsonOutput }, null, 2));
    return;
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("  Project comparison"));
  lines.push("");

  const head = ["Project", "Sessions", "Grade", ...summaries[0]?.metrics.keys() ?? []].map(
    (h) => chalk.dim(h),
  );

  const table = new Table({
    head,
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  for (const summary of summaries) {
    const row: string[] = [
      summary.name,
      summary.sessionCount.toString(),
      summary.avgLetter,
    ];
    for (const [, value] of summary.metrics) {
      row.push(value.toFixed(2));
    }
    table.push(row);
  }

  lines.push(table.toString());
  lines.push("");
  console.log(lines.join("\n"));
}

function getLetterGrade(score: number): string {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 63) return "D";
  if (score >= 60) return "D-";
  return "F";
}
