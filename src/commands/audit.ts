/**
 * Default command — grade the most recent session.
 */

import { getMostRecentSession } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { renderAuditReport } from "../reporter/terminal.js";
import { formatAuditJson } from "../reporter/json-reporter.js";

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
  );

  const grade = gradeSession(session);

  if (options.json) {
    console.log(formatAuditJson(session, grade));
  } else {
    console.log(renderAuditReport(session, grade));
  }
}
