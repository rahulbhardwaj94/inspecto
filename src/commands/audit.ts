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

const KNOWN_FORMAT_VERSION = "2.1.167";

export interface AuditOptions {
  json?: boolean;
  verbose?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runAudit(options: AuditOptions): Promise<void> {
  const sessionFile = await getMostRecentSession({
    dataDir: options.dataDir,
    project: options.project,
  });

  const records = readJsonl(sessionFile.path);
  const session = await buildSession(
    records,
    sessionFile.sessionId,
    sessionFile.projectSlug,
    sessionFile.subagentPaths,
  );

  const grade = gradeSession(session);

  if (options.json) {
    console.log(formatAuditJson(session, grade));
    return;
  }

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
