/**
 * Watch command — live metric updates as Claude Code writes to the active session.
 */

import { watch as fsWatch } from "node:fs";
import { stat } from "node:fs/promises";
import chalk from "chalk";
import { getMostRecentSession } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { renderAuditReport } from "../reporter/terminal.js";
import { loadConfig } from "../config/loader.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export interface WatchOptions {
  project?: string;
  dataDir?: string;
  interval?: string;
}

export async function runWatch(options: WatchOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const pollIntervalMs = parseInt(options.interval ?? "2000", 10);

  const sessionFile = await getMostRecentSession({ dataDir, project });
  const filePath = sessionFile.path;

  let lastSize = 0;
  let lastChangeTime = Date.now();
  let idleWarningShown = false;
  let firstRender = true;
  let rendering = false;
  let watcher: ReturnType<typeof fsWatch> | null = null;

  function cleanup() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  }

  async function render() {
    if (rendering) return;
    rendering = true;
    try {
      let currentStat;
      try {
        currentStat = await stat(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          process.stdout.write("  Session file removed. Exiting.\n");
          cleanup();
          process.exitCode = 0;
          process.exit(0);
        }
        return;
      }

      const currentSize = currentStat.size;
      if (!firstRender && currentSize === lastSize) return;

      if (currentSize !== lastSize) {
        lastChangeTime = Date.now();
        idleWarningShown = false;
      }

      let session;
      try {
        const records = readJsonl(filePath);
        session = await buildSession(
          records,
          sessionFile.sessionId,
          sessionFile.projectSlug,
          sessionFile.subagentPaths,
        );
      } catch {
        // Claude Code may be mid-write; skip this render
        return;
      }

      const grade = gradeSession(session, config);
      const report = renderAuditReport(session, grade);
      const timeStr = new Date().toTimeString().slice(0, 8);

      if (!firstRender) {
        process.stdout.write("\x1b[2J\x1b[H");
      }

      process.stdout.write(
        `  ${chalk.red("◉")} LIVE  watching session ${chalk.cyan(sessionFile.sessionId.slice(0, 8))}...  ${chalk.dim("(Ctrl-C to stop)")}\n`,
      );
      process.stdout.write(report);
      process.stdout.write(chalk.dim(`  Last updated: ${timeStr}\n\n`));

      lastSize = currentSize;
      firstRender = false;
    } finally {
      rendering = false;
    }
  }

  function checkIdle() {
    if (!idleWarningShown && Date.now() - lastChangeTime > IDLE_TIMEOUT_MS) {
      idleWarningShown = true;
      process.stdout.write(
        `\n  ${chalk.dim("○")} Session appears complete. Press Ctrl-C to exit or continue watching.\n`,
      );
    }
  }

  process.on("SIGINT", () => {
    cleanup();
    process.stdout.write("\n");
    process.exitCode = 0;
    process.exit(0);
  });

  // Initial render
  await render();

  // Set up fs.watch for immediate change detection
  try {
    watcher = fsWatch(filePath, () => {
      render().catch(() => {});
    });
    watcher.on("error", () => {});
  } catch {
    // fs.watch unavailable — polling only
  }

  // Polling loop: fallback / supplement to fs.watch, and idle detection
  while (true) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    await render();
    checkIdle();
  }
}
