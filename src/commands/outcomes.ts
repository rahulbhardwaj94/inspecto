/**
 * Outcomes command — link sessions to git commits and measure whether the
 * work survived. Answers "was it worth it": edit survival rate and cost per
 * surviving change, per session and aggregated.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { analyzeSessionOutcome, aggregateOutcomes } from "../outcomes/analyze.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { shortSessionId, projectNameFromSlug, formatPercent } from "../utils/format.js";
import { VERSION } from "../version.js";
import type { SessionFile } from "../parser/types.js";
import type { OutcomeAggregate, SessionOutcome } from "../outcomes/types.js";

/** Git subprocess pressure — keep lower than the parse concurrency. */
const CONCURRENCY = 4;

export interface OutcomesOptions {
  since?: string;
  limit?: string;
  json?: boolean;
  format?: string;
  dataDir?: string;
  project?: string;
}

export async function runOutcomes(options: OutcomesOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const duration = options.since ?? "14d";
  const limit = Number(options.limit ?? 50);

  const sessionFiles = (
    await scanSessions({ dataDir, project, since: parseDuration(duration) })
  ).slice(0, limit);

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in the last ${duration}.`);
    return;
  }

  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(
      readJsonl(sf.path),
      sf.sessionId,
      sf.projectSlug,
      sf.subagentPaths,
    );
    return analyzeSessionOutcome(session);
  });

  const outcomes: SessionOutcome[] = settled
    .filter((r): r is PromiseFulfilledResult<SessionOutcome> => r.status === "fulfilled")
    .map((r) => r.value);

  const aggregate = aggregateOutcomes(outcomes);

  if (options.json || options.format === "json") {
    console.log(JSON.stringify({ aggregate, sessions: outcomes }, jsonReplacer, 2));
  } else if (options.format === "csv") {
    console.log(exportOutcomesCsv(outcomes));
  } else {
    console.log(renderOutcomesReport(outcomes, aggregate, duration));
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return value instanceof Set ? [...value] : value;
}

function exportOutcomesCsv(outcomes: SessionOutcome[]): string {
  const esc = (v: string | number | null): string => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    [
      "sessionId",
      "project",
      "commits",
      "linesAdded",
      "linesSurviving",
      "survivalRate",
      "costUsd",
      "costPerSurvivingChange",
      "skippedReason",
    ].join(","),
  ];
  for (const o of outcomes) {
    lines.push(
      [
        esc(o.sessionId),
        esc(o.projectSlug),
        esc(o.commits.length),
        esc(o.linesAdded),
        esc(o.linesSurviving),
        esc(o.survivalRate),
        esc(o.costUsd),
        esc(o.costPerSurvivingChange),
        esc(o.skippedReason),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function renderOutcomesReport(
  outcomes: SessionOutcome[],
  aggregate: OutcomeAggregate,
  duration: string,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    chalk.bold(`  inspecto v${VERSION}`) + chalk.dim(" — Outcome verification (session → git)"),
  );
  lines.push("");

  const linked = outcomes.filter((o) => o.commits.length > 0);
  const unlinked = outcomes.filter((o) => o.skippedReason === null && o.commits.length === 0);
  const skipped = outcomes.filter((o) => o.skippedReason !== null);

  if (linked.length > 0) {
    const table = new Table({
      head: ["Session", "Project", "Commits", "Lines", "Survival", "Cost", "$/change"].map((h) =>
        chalk.bold(h),
      ),
      style: { head: [], border: [] },
    });

    for (const o of linked) {
      table.push([
        shortSessionId(o.sessionId),
        projectNameFromSlug(o.projectSlug),
        String(o.commits.length),
        `${o.linesAdded} → ${o.linesSurviving}`,
        colorSurvival(o.survivalRate),
        o.costUsd !== null ? `$${o.costUsd.toFixed(2)}` : chalk.dim("—"),
        o.costPerSurvivingChange !== null
          ? `$${o.costPerSurvivingChange.toFixed(2)}`
          : chalk.dim("—"),
      ]);
    }
    lines.push(indent(table.toString()));
  } else {
    lines.push(chalk.dim("  No sessions could be linked to commits in this window."));
  }

  lines.push("");
  lines.push(chalk.bold(`  Aggregate (last ${duration})`));
  lines.push(`    Sessions analyzed:        ${aggregate.sessionsAnalyzed}`);
  lines.push(
    `    Linked to commits:        ${aggregate.sessionsLinked}` +
      (aggregate.linkRate !== null
        ? chalk.dim(` (link rate ${formatPercent(aggregate.linkRate)})`)
        : ""),
  );
  if (unlinked.length > 0) {
    lines.push(
      chalk.dim(
        `    No matching commits:      ${unlinked.length} (work may be uncommitted or committed later)`,
      ),
    );
  }
  if (skipped.length > 0) {
    const reasons = new Map<string, number>();
    for (const o of skipped) {
      reasons.set(o.skippedReason!, (reasons.get(o.skippedReason!) ?? 0) + 1);
    }
    const summary = [...reasons.entries()].map(([r, n]) => `${n}× ${r}`).join(", ");
    lines.push(chalk.dim(`    Skipped:                  ${skipped.length} (${summary})`));
  }
  if (aggregate.avgSurvivalRate !== null) {
    lines.push(
      `    Edit survival rate:       ${colorSurvival(aggregate.avgSurvivalRate)}` +
        chalk.dim(
          ` (${aggregate.totalLinesSurviving.toLocaleString("en-US")} of ${aggregate.totalLinesAdded.toLocaleString("en-US")} lines alive at HEAD)`,
        ),
    );
  }
  lines.push(`    Total cost (all above):   $${aggregate.totalCostUsd.toFixed(2)}`);
  if (aggregate.costPerSurvivingChange !== null) {
    lines.push(
      chalk.bold(
        `    Cost per surviving change: $${aggregate.costPerSurvivingChange.toFixed(2)}`,
      ) + chalk.dim(` (${aggregate.totalCommits} commits)`),
    );
  }
  lines.push("");
  return lines.join("\n");
}

function colorSurvival(rate: number | null): string {
  if (rate === null) return chalk.dim("—");
  const pct = formatPercent(rate);
  if (rate >= 0.7) return chalk.green(pct);
  if (rate >= 0.4) return chalk.yellow(pct);
  return chalk.red(pct);
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}
