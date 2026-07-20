/**
 * Calibrate command — test the 12 quality metrics against real outcomes.
 *
 * Answers "which of these metrics actually predict whether the code survived?"
 * Each session is parsed once and used for both its grade and its git outcome.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { analyzeSessionOutcome } from "../outcomes/analyze.js";
import { calibrate, MIN_SAMPLES } from "../calibrate/calibrate.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { formatPercent } from "../utils/format.js";
import { VERSION } from "../version.js";
import type { SessionFile } from "../parser/types.js";
import type {
  CalibrationReport,
  MetricCalibration,
  OutcomeSample,
  Verdict,
} from "../calibrate/calibrate.js";

/** Git subprocess pressure — matches the outcomes command. */
const CONCURRENCY = 4;

export interface CalibrateOptions {
  since?: string;
  limit?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runCalibrate(options: CalibrateOptions): Promise<void> {
  const config = loadConfig();
  const since = options.since ?? "90d";
  const limit = Number(options.limit ?? 200);

  const sessionFiles = (
    await scanSessions({
      dataDir: options.dataDir ?? config.dataDir,
      project: options.project ?? config.defaultProject,
      since: parseDuration(since),
    })
  ).slice(0, limit);

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in the last ${since}.`);
    return;
  }

  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(
      readJsonl(sf.path),
      sf.sessionId,
      sf.projectSlug,
      sf.subagentPaths,
    );
    const grade = gradeSession(session, config);
    const outcome = await analyzeSessionOutcome(session);
    return {
      metrics: grade.metrics,
      survivalRate: outcome.commits.length > 0 ? outcome.survivalRate : null,
      costPerCommit: outcome.costPerSurvivingChange,
    } satisfies OutcomeSample;
  });

  const samples = settled
    .filter((r): r is PromiseFulfilledResult<OutcomeSample> => r.status === "fulfilled")
    .map((r) => r.value);

  const report = calibrate(samples);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(render(report, since));
}

// ---------------------------------------------------------------------------

const VERDICT_LABELS: Record<Verdict, string> = {
  predictive: chalk.green("predictive"),
  weak: chalk.cyan("weak"),
  "no-signal": chalk.dim("no signal"),
  "false-alarm": chalk.red("FALSE ALARM"),
  "insufficient-data": chalk.dim("need more data"),
  informational: chalk.dim("informational"),
};

const VERDICT_ORDER: Record<Verdict, number> = {
  "false-alarm": 0,
  predictive: 1,
  weak: 2,
  "no-signal": 3,
  "insufficient-data": 4,
  informational: 5,
};

function render(report: CalibrationReport, since: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    chalk.bold(`  inspecto v${VERSION}`) +
      chalk.dim(" — Metric calibration (do these metrics predict outcomes?)"),
  );
  lines.push("");

  if (report.sessionsWithOutcomes === 0) {
    lines.push(
      chalk.yellow("  No sessions could be linked to git commits, so there is nothing to"),
    );
    lines.push(chalk.yellow("  calibrate against. Run `inspecto outcomes` to see why."));
    lines.push("");
    return lines.join("\n");
  }

  const sorted = [...report.metrics].sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.name.localeCompare(b.name),
  );

  const table = new Table({
    head: ["Metric", "n", "ρ survival", "ρ $/commit", "Fires", "Theory", "Verdict"].map((h) =>
      chalk.bold(h),
    ),
    style: { head: [], border: [] },
  });

  for (const m of sorted) {
    table.push([
      m.name,
      String(m.n),
      correlation(m.survivalSpearman),
      correlation(m.costPerCommitSpearman),
      firesLabel(m.firesRate),
      theoryLabel(m),
      VERDICT_LABELS[m.verdict],
    ]);
  }
  lines.push(
    table
      .toString()
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  lines.push("");
  lines.push(
    `  ${report.sessionsAnalyzed} sessions in the last ${since}; ` +
      `${chalk.bold(String(report.sessionsWithOutcomes))} linked to commits and usable for calibration.`,
  );

  const falseAlarms = sorted.filter((m) => m.verdict === "false-alarm");
  if (falseAlarms.length > 0) {
    lines.push("");
    lines.push(chalk.red.bold("  False alarms — firing constantly, predicting nothing:"));
    for (const m of falseAlarms) {
      lines.push(
        `    ${chalk.bold(m.name)} fires on ${formatPercent(m.firesRate)} of sessions but ` +
          `shows no relationship to whether the code survived (ρ=${m.survivalSpearman?.toFixed(2)}, n=${m.n}).`,
      );
    }
    lines.push(
      chalk.dim("    Consider raising its threshold in .inspecto.json, or lowering its weight."),
    );
  }

  const mismatched = sorted.filter(
    (m) => m.directionMatchesTheory === false && (m.verdict === "predictive" || m.verdict === "weak"),
  );
  if (mismatched.length > 0) {
    lines.push("");
    lines.push(chalk.yellow.bold("  Correlating opposite to the grader's assumption:"));
    for (const m of mismatched) {
      lines.push(
        `    ${chalk.bold(m.name)} moves against theory (ρ=${m.survivalSpearman?.toFixed(2)}). ` +
          `Worth investigating before trusting it.`,
      );
    }
  }

  lines.push("");
  lines.push(
    chalk.dim(
      `  ρ is Spearman rank correlation against edit survival. Verdicts need n ≥ ${MIN_SAMPLES}.`,
    ),
  );
  lines.push(
    chalk.dim(
      "  This is YOUR history, not universal truth — correlation is not causation, and",
    ),
  );
  lines.push(
    chalk.dim(
      "  survival has a ceiling effect (most sessions survive), which compresses ρ.",
    ),
  );
  lines.push("");
  return lines.join("\n");
}

function correlation(value: number | null): string {
  if (value === null) return chalk.dim("—");
  const text = value.toFixed(2).padStart(5);
  const strength = Math.abs(value);
  if (strength >= 0.5) return chalk.green(text);
  if (strength >= 0.3) return chalk.cyan(text);
  return chalk.dim(text);
}

function firesLabel(rate: number): string {
  const text = formatPercent(rate);
  if (rate >= 0.5) return chalk.red(text);
  if (rate >= 0.25) return chalk.yellow(text);
  return chalk.dim(text);
}

function theoryLabel(m: MetricCalibration): string {
  if (m.directionMatchesTheory === null) return chalk.dim("—");
  return m.directionMatchesTheory ? chalk.green("✓") : chalk.red("✗ inverted");
}
