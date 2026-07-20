/**
 * Report command — generate a self-contained HTML report of the fleet,
 * optionally including outcome verification (session → git survival).
 */

import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectFleet } from "./fleet.js";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { analyzeSessionOutcome, aggregateOutcomes } from "../outcomes/analyze.js";
import { renderHtmlReport } from "../reporter/html-reporter.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import type { SessionFile } from "../parser/types.js";
import type { SessionOutcome } from "../outcomes/types.js";

export interface ReportOptions {
  since?: string;
  limit?: string;
  out?: string;
  outcomes?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runReport(options: ReportOptions): Promise<void> {
  const since = options.since ?? "7d";
  const limit = Number(options.limit ?? 50);

  const rows = await collectFleet({
    since,
    limit,
    dataDir: options.dataDir,
    project: options.project,
  });

  if (rows.length === 0) {
    console.log(`No sessions found in the last ${since}.`);
    return;
  }

  let outcomes: SessionOutcome[] | undefined;
  if (options.outcomes) {
    const config = loadConfig();
    const sessionFiles = (
      await scanSessions({
        dataDir: options.dataDir ?? config.dataDir,
        project: options.project ?? config.defaultProject,
        since: parseDuration(since),
      })
    ).slice(0, limit);

    const settled = await concurrentSettled(sessionFiles, 4, async (sf: SessionFile) => {
      const session = await buildSession(
        readJsonl(sf.path),
        sf.sessionId,
        sf.projectSlug,
        sf.subagentPaths,
      );
      return analyzeSessionOutcome(session);
    });
    outcomes = settled
      .filter((r): r is PromiseFulfilledResult<SessionOutcome> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  const html = renderHtmlReport({
    since,
    generatedAt: new Date(),
    rows,
    outcomes,
    outcomeAggregate: outcomes ? aggregateOutcomes(outcomes) : undefined,
  });

  const outPath = resolve(options.out ?? "inspecto-report.html");
  await writeFile(outPath, html, "utf8");
  console.log(
    `\n  ${chalk.green("✓")} Report written: ${chalk.cyan(outPath)}` +
      chalk.dim(` (${rows.length} sessions${outcomes ? ", with outcomes" : ""})`) +
      "\n",
  );
}
