/**
 * inspecto — Claude Code Session Quality Analyzer
 *
 * Grade sessions, detect regressions, catch cache bugs.
 * All from the JSONL logs Claude Code already writes.
 */

import { Command } from "commander";
import { runAudit } from "./commands/audit.js";
import { runTrend } from "./commands/trend.js";
import { runCacheCheck } from "./commands/cache-check.js";
import { runCompare } from "./commands/compare.js";

const program = new Command();

program
  .name("inspecto")
  .description("Claude Code session quality analyzer — grade sessions, detect regressions, catch cache bugs")
  .version("1.0.0");

program
  .command("audit", { isDefault: true })
  .description("Grade the most recent Claude Code session")
  .option("--json", "Output as JSON")
  .option("--verbose", "Show per-message breakdown")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runAudit(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("trend")
  .description("Analyze quality trends and detect regressions over time")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "7d")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runTrend(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("cache-check")
  .description("Detect prompt cache bugs that inflate token costs")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "7d")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .action(async (options) => {
    try {
      await runCacheCheck(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("compare")
  .description("Compare quality metrics across projects")
  .requiredOption("--projects <names>", "Comma-separated project names")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--since <duration>", "Time range: 7d, 14d, 30d")
  .action(async (options) => {
    try {
      await runCompare(options);
    } catch (error) {
      handleError(error);
    }
  });

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

program.parse();
