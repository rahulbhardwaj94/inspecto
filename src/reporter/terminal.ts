/**
 * Terminal output formatting using chalk and cli-table3.
 */

import chalk from "chalk";
import Table from "cli-table3";
import type { GradeResult, MetricResult, Session } from "../parser/types.js";
import type { RegressionResult } from "../anomaly/regression-detector.js";
import type { CacheCheckResult } from "../anomaly/cache-anomaly.js";
import { formatDuration, shortSessionId, projectNameFromSlug, formatNumber } from "../utils/format.js";
import { getAllTips } from "./tips.js";

const STATUS_ICONS: Record<string, string> = {
  healthy: chalk.green("✓"),
  warning: chalk.yellow("⚠"),
  critical: chalk.red("✗"),
};

const STATUS_LABELS: Record<string, string> = {
  healthy: chalk.green("healthy"),
  warning: chalk.yellow("warning"),
  critical: chalk.red("critical"),
};

const METRIC_DISPLAY_NAMES: Record<string, string> = {
  "reads-per-edit": "Reads/edit",
  "rewrite-ratio": "Rewrite ratio",
  "cache-hit-rate": "Cache hit rate",
  "task-completion": "Task completion",
  "retry-density": "Retry density",
  "tool-diversity": "Tool diversity",
  "tokens-per-edit": "Tokens/useful-edit",
};

export function renderAuditReport(session: Session, grade: GradeResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("  cc-audit v1.0.0") + chalk.dim(" — Claude Code Session Quality Analyzer"));
  lines.push("");

  const sessionInfo = [
    `Session: ${chalk.cyan(shortSessionId(session.id))}`,
    projectNameFromSlug(session.projectSlug),
    formatDuration(session.durationMs),
    session.model,
  ].join(chalk.dim(" | "));
  lines.push(`  ${sessionInfo}`);
  lines.push("");

  const gradeColor = getGradeColor(grade.letter);
  lines.push(`  Overall grade: ${gradeColor(chalk.bold(grade.letter))}`);
  lines.push("");

  const table = new Table({
    head: ["Metric", "Value", "Status"].map((h) => chalk.dim(h)),
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  for (const metric of grade.metrics) {
    const displayName = METRIC_DISPLAY_NAMES[metric.name] ?? metric.name;
    const icon = STATUS_ICONS[metric.status] ?? "";
    table.push([displayName, metric.label, `${icon} ${STATUS_LABELS[metric.status] ?? metric.status}`]);
  }

  lines.push(table.toString());

  const tips = getAllTips(grade.metrics);
  if (tips.length > 0) {
    lines.push("");
    lines.push(chalk.yellow("  Tips:"));
    for (const tip of tips) {
      lines.push(`  ${chalk.dim("→")} ${tip}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function renderTrendReport(
  results: RegressionResult[],
  sessionCount: number,
  period: string,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`  Trend report: last ${period}`) + chalk.dim(` (${sessionCount} sessions)`));
  lines.push("");

  const table = new Table({
    head: ["Metric", "Recent avg", "Full avg", "Change", "Status"].map((h) => chalk.dim(h)),
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  for (const result of results) {
    const displayName = METRIC_DISPLAY_NAMES[result.name] ?? result.name;
    const recentStr = result.recentAvg !== null ? result.recentAvg.toFixed(2) : "N/A";
    const fullStr = result.fullAvg !== null ? result.fullAvg.toFixed(2) : "N/A";

    let changeStr = "N/A";
    if (result.changePercent !== null) {
      const arrow = result.changePercent > 0 ? "▲" : result.changePercent < 0 ? "▼" : "";
      changeStr = `${arrow} ${Math.abs(Math.round(result.changePercent))}%`;
    }

    const statusStr = formatRegressionStatus(result.status);
    table.push([displayName, recentStr, fullStr, changeStr, statusStr]);
  }

  lines.push(table.toString());
  lines.push("");
  return lines.join("\n");
}

export function renderCacheCheckReport(results: CacheCheckResult[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold("  Cache health check"));
  lines.push("");

  const table = new Table({
    head: ["Session", "Project", "Cache Hit", "Status"].map((h) => chalk.dim(h)),
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  for (const result of results) {
    const hitStr = result.cacheHitRate !== null ? result.cacheHitRate.toFixed(2) : "N/A";
    const statusStr = result.isAnomaly
      ? chalk.red("✗ ANOMALY")
      : chalk.green("✓ normal");

    table.push([
      shortSessionId(result.sessionId),
      projectNameFromSlug(result.projectSlug),
      hitStr,
      statusStr,
    ]);
  }

  lines.push(table.toString());

  const anomalies = results.filter((r) => r.isAnomaly);
  if (anomalies.length > 0) {
    lines.push("");
    lines.push(
      chalk.yellow(`  ⚠ ${anomalies.length} session(s) with abnormally low cache hit rate.`),
    );
    for (const a of anomalies) {
      if (a.estimatedInflation) {
        lines.push(
          `  ${chalk.dim("→")} Session ${shortSessionId(a.sessionId)} consumed ~${a.estimatedInflation}x more input tokens than expected.`,
        );
      }
    }
    lines.push(
      chalk.dim("  Try: restart Claude Code or downgrade to a previous version."),
    );
  } else {
    lines.push("");
    lines.push(chalk.green("  ✓ No cache anomalies detected."));
  }

  lines.push("");
  return lines.join("\n");
}

function getGradeColor(letter: string): (text: string) => string {
  if (letter.startsWith("A")) return chalk.green;
  if (letter.startsWith("B")) return chalk.cyan;
  if (letter.startsWith("C")) return chalk.yellow;
  return chalk.red;
}

function formatRegressionStatus(status: string): string {
  switch (status) {
    case "stable":
      return chalk.green("✓ stable");
    case "declining":
      return chalk.yellow("⚠ declining");
    case "regression":
      return chalk.red("⚠ REGRESSION");
    default:
      return status;
  }
}
