/**
 * Cache bug detection command.
 * Scans recent sessions for abnormally low cache hit rates.
 */

import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { checkCacheAnomaly } from "../anomaly/cache-anomaly.js";
import { renderCacheCheckReport } from "../reporter/terminal.js";
import { formatCacheCheckJson } from "../reporter/json-reporter.js";
import { parseDuration } from "../utils/duration.js";
import type { CacheCheckResult } from "../anomaly/cache-anomaly.js";

export interface CacheCheckOptions {
  since?: string;
  json?: boolean;
  dataDir?: string;
}

export async function runCacheCheck(options: CacheCheckOptions): Promise<void> {
  const duration = options.since ?? "7d";
  const sinceDate = parseDuration(duration);

  const sessionFiles = await scanSessions({
    dataDir: options.dataDir,
    since: sinceDate,
  });

  if (sessionFiles.length === 0) {
    console.log(`No sessions found in the last ${duration}.`);
    return;
  }

  const results: CacheCheckResult[] = [];
  for (const sf of sessionFiles) {
    try {
      const records = readJsonl(sf.path);
      const session = await buildSession(records, sf.sessionId, sf.projectSlug);
      results.push(checkCacheAnomaly(session));
    } catch {
      // Skip sessions that fail to parse
    }
  }

  if (results.length === 0) {
    console.log("No valid sessions found to analyze.");
    return;
  }

  if (options.json) {
    console.log(formatCacheCheckJson(results));
  } else {
    console.log(renderCacheCheckReport(results));
  }
}
