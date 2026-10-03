/**
 * inspecto — Claude Code Session Quality Analyzer
 *
 * Grade sessions, detect regressions, catch cache bugs.
 * All from the JSONL logs Claude Code already writes.
 */

import { Command } from "commander";
import { unlink } from "node:fs/promises";
import { runAudit } from "./commands/audit.js";
import { runTrend } from "./commands/trend.js";
import { runCacheCheck } from "./commands/cache-check.js";
import { runCompare } from "./commands/compare.js";
import { runList } from "./commands/list.js";
import { runWatch } from "./commands/watch.js";
import { runConfigValidate } from "./commands/config-validate.js";
import { runExportMetrics } from "./commands/export-metrics.js";
import { runOutcomes } from "./commands/outcomes.js";
import { runFleet } from "./commands/fleet.js";
import { runReport } from "./commands/report.js";
import { runCalibrate } from "./commands/calibrate.js";
import { runFix } from "./commands/fix.js";
import { runStatusline } from "./commands/statusline.js";
import { runWrapped } from "./commands/wrapped.js";
import { runPulse } from "./commands/pulse.js";
import { getCacheFilePath } from "./utils/paths.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("inspecto")
  .description("Claude Code session quality analyzer — grade sessions, detect regressions, catch cache bugs")
  .version(VERSION);

program
  .command("audit", { isDefault: true })
  .description("Grade the most recent Claude Code session")
  .option("--json", "Output as JSON")
  .option("--format <format>", "Output format: json, csv")
  .option("--verbose", "Show per-message breakdown")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .option("--no-fail", "Always exit 0, even for D/F grades")
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
  .option("--format <format>", "Output format: json, csv")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .option("--no-fail", "Always exit 0, even on regressions")
  .action(async (options) => {
    try {
      await runTrend(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("export")
  .description("Export pseudonymous session metrics for a private team baseline")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "30d")
  .option("--format <format>", "Output format: csv, json", "csv")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      if (!['csv', 'json'].includes(options.format)) {
        throw new Error('Invalid format. Use "csv" or "json".');
      }
      await runExportMetrics(options);
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
  .option("--no-fail", "Always exit 0, even when anomalies are detected")
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
  .option("--no-fail", "No-op (compare always exits 0)")
  .action(async (options) => {
    try {
      await runCompare(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("list")
  .description("List discovered projects and sessions")
  .option("--sessions", "Show 20 most recent sessions instead of projects")
  .option("--project <name>", "Filter to sessions for a specific project")
  .option("--data-dir <path>", "Custom Claude data directory")
  .action(async (options) => {
    try {
      await runList(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("watch")
  .description("Watch the active Claude Code session and update metrics live")
  .option("--project <name>", "Filter to a specific project")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--interval <ms>", "Polling interval in milliseconds", "2000")
  .action(async (options) => {
    try {
      await runWatch(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("fleet")
  .description("Show every agent run in the window: project, model, duration, cost, grade")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "7d")
  .option("--limit <n>", "Maximum sessions to show", "50")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runFleet(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("outcomes")
  .description("Link sessions to git commits and measure edit survival and cost per surviving change")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "14d")
  .option("--limit <n>", "Maximum sessions to analyze", "50")
  .option("--json", "Output as JSON")
  .option("--format <format>", "Output format: json, csv")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runOutcomes(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("calibrate")
  .description("Test which quality metrics actually predict outcomes in your own history")
  .option("--since <duration>", "Time range: 30d, 90d", "90d")
  .option("--limit <n>", "Maximum sessions to analyze", "200")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runCalibrate(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("fix")
  .description("Turn recurring session failures in this repo into CLAUDE.md rules, and check whether past rules helped")
  .option("--apply", "Write proposed rules into CLAUDE.md (default: dry run)")
  .option("--since <duration>", "Time range: 7d, 14d, 30d, 90d", "30d")
  .option("--min <n>", "Minimum occurrences before a failure becomes a rule", "2")
  .option("--repo <path>", "Repository to analyze (default: current directory)")
  .option("--file <path>", "CLAUDE.md to read and write (default: <repo>/CLAUDE.md)")
  .option("--json", "Output as JSON")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runFix(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("statusline [action]")
  .description("Live one-line summary for Claude Code's status bar; `install` / `uninstall` manage settings.json")
  .option("--project", "Use this project's .claude/settings.json instead of ~/.claude/settings.json")
  .option("--force", "Replace an existing non-inspecto statusLine")
  .action(async (action, options) => {
    try {
      await runStatusline(action, options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("wrapped")
  .description("Your year in Claude Code as shareable story cards (self-contained HTML)")
  .option("--year <yyyy>", "Calendar year (default: current year)")
  .option("--names", "Show project and file names (hidden by default for safe sharing)")
  .option("--out <path>", "Output file path (default: inspecto-wrapped-<year>.html)")
  .option("--json", "Print the stats as JSON instead of writing HTML")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runWrapped(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("pulse")
  .description("Is Claude off today? Compare each model's recent sessions with your own baseline")
  .option("--hours <n>", "Recent window in hours", "24")
  .option("--baseline <days>", "Baseline window in days before the recent window", "14")
  .option("--json", "Output as JSON")
  .option("--share-preview", "Print the anonymous community payload without sending it")
  .option("--share", "Send the anonymous payload to the configured pulse endpoint (opt-in)")
  .option("--endpoint <url>", "Pulse collector URL (or set INSPECTO_PULSE_URL)")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .option("--no-fail", "Always exit 0, even when a model looks worse than usual")
  .action(async (options) => {
    try {
      await runPulse(options);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("report")
  .description("Generate a self-contained HTML report (fleet view, optionally with git outcomes)")
  .option("--since <duration>", "Time range: 7d, 14d, 30d", "7d")
  .option("--limit <n>", "Maximum sessions to include", "50")
  .option("--outcomes", "Include outcome verification (session → git survival)")
  .option("--out <path>", "Output file path", "inspecto-report.html")
  .option("--data-dir <path>", "Custom Claude data directory")
  .option("--project <name>", "Filter to a specific project")
  .action(async (options) => {
    try {
      await runReport(options);
    } catch (error) {
      handleError(error);
    }
  });

const config = program
  .command("config")
  .description("Manage inspecto configuration");

config
  .command("validate")
  .description("Show effective configuration merged from .inspecto.json and defaults")
  .action(async () => {
    try {
      await runConfigValidate();
    } catch (error) {
      handleError(error);
    }
  });

const cache = program
  .command("cache")
  .description("Manage the inspecto grade cache");

cache
  .command("clear")
  .description("Delete the grade cache file (~/.claude/inspecto-cache.db)")
  .action(async () => {
    try {
      const cachePath = getCacheFilePath();
      try {
        await unlink(cachePath);
        console.log(`Cache cleared: ${cachePath}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.log("No cache file found.");
        } else {
          throw err;
        }
      }
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
