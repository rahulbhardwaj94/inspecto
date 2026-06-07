/**
 * Default command — grade the most recent session.
 */

import chalk from "chalk";
import { getMostRecentSession } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { renderAuditReport } from "../reporter/terminal.js";
import { formatAuditJson } from "../reporter/json-reporter.js";
import { exportAuditCsv } from "../reporter/csv-reporter.js";
import { loadConfig } from "../config/loader.js";

const KNOWN_FORMAT_VERSION = "2.1.167";

export interface AuditOptions {
  json?: boolean;
  verbose?: boolean;
  dataDir?: string;
  project?: string;
  /** false when --no-fail is passed; defaults to true via Commander */
  fail?: boolean;
  format?: string;
}

export async function runAudit(options: AuditOptions): Promise<void> {
  const config = loadConfig();

  // CLI flags take precedence over config file, config file takes precedence over defaults
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;

  const sessionFile = await getMostRecentSession({ dataDir, project });

  const records = readJsonl(sessionFile.path);
  const session = await buildSession(
    records,
    sessionFile.sessionId,
    sessionFile.projectSlug,
    sessionFile.subagentPaths,
  );

  const grade = gradeSession(session, config);

  if (options.json || options.format === "json") {
    console.log(formatAuditJson(session, grade));
  } else if (options.format === "csv") {
    console.log(exportAuditCsv(grade));
  } else {
    if (session.formatVersion && session.formatVersion !== KNOWN_FORMAT_VERSION) {
      console.log(
        chalk.yellow(
          `⚠ JSONL format version ${session.formatVersion} detected (expected ${KNOWN_FORMAT_VERSION}). Metrics may be inaccurate.`,
        ),
      );
    }

    if (session.unknownRecordTypes.size > 0) {
      const types = [...session.unknownRecordTypes].sort().join(", ");
      process.stdout.write(chalk.dim(`Note: skipped unknown record types: ${types}\n`));
    }

    console.log(renderAuditReport(session, grade));
  }

  if (options.fail !== false && grade.score < 67) {
    process.exitCode = 1;
  }
}
