/**
 * Wrapped command — a year of Claude Code sessions as a shareable page of
 * story cards, plus a short terminal summary.
 */

import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession, gradeLetterFromScore } from "../metrics/grader.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { computeWrapped, digestSession, type SessionDigest, type WrappedStats } from "../wrapped/compute.js";
import { compact, renderWrappedHtml } from "../wrapped/html.js";
import type { SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;

export interface WrappedCommandOptions {
  year?: string;
  names?: boolean;
  out?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runWrapped(options: WrappedCommandOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const year = options.year ? Number(options.year) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 3000) {
    throw new Error(`Invalid --year "${options.year}". Use a four-digit year like 2026.`);
  }

  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);

  // mtime >= Jan 1 is a cheap pre-filter; the session's own start time decides.
  const files = await scanSessions({ dataDir, project, since: from });
  const settled = await concurrentSettled(files, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(readJsonl(sf.path), sf.sessionId, sf.projectSlug, sf.subagentPaths);
    const start = Date.parse(session.startTime);
    if (Number.isNaN(start) || start < from.getTime() || start >= to.getTime()) return null;
    return digestSession(session, gradeSession(session, config));
  });

  const digests = settled
    .filter((r): r is PromiseFulfilledResult<SessionDigest | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((d): d is SessionDigest => d !== null);

  if (digests.length === 0) {
    console.log(`No Claude Code sessions found that started in ${year}.`);
    return;
  }

  const stats = computeWrapped(digests, { year });

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const outPath = resolve(options.out ?? `inspecto-wrapped-${year}.html`);
  await writeFile(outPath, renderWrappedHtml(stats, { showNames: options.names }), "utf8");
  console.log(renderTerminal(stats, outPath, options.names ?? false));
}

function renderTerminal(s: WrappedStats, outPath: string, names: boolean): string {
  const lines: string[] = [""];
  lines.push(chalk.bold(`  ✨ Your ${s.year} in Claude Code`));
  lines.push("");
  const hours = Math.round(s.totalHours);
  lines.push(`  ${chalk.bold(compact(s.sessions))} ${plural(s.sessions, "session")} · ${chalk.bold(compact(hours))} ${plural(hours, "hour")} · ${s.activeDays} active ${plural(s.activeDays, "day")} · ${s.longestStreak}-day best streak`);
  lines.push(`  ${chalk.bold(compact(s.linesWritten))} lines written across ${compact(s.filesEdited)} ${plural(s.filesEdited, "file")} · ~$${s.totalCostUsd.toFixed(0)} spent`);
  if (s.topTools[0]) lines.push(`  Favourite tool: ${chalk.bold(s.topTools[0].name)}${s.topModels[0] ? ` · top model: ${chalk.bold(s.topModels[0].name)}` : ""}`);
  lines.push(`  Average grade: ${chalk.bold(gradeLetterFromScore(s.avgScore))}${s.cacheHitRate !== null ? ` · cache hit rate ${Math.round(s.cacheHitRate * 100)}%` : ""}`);
  lines.push("");
  lines.push(`  ${s.persona.emoji}  ${chalk.bold(s.persona.name)} — ${s.persona.blurb}`);
  lines.push("");
  lines.push(`  ${chalk.green("✓")} Wrapped written: ${chalk.cyan(outPath)}`);
  lines.push(
    chalk.dim(
      names
        ? "    Project and file names are included. Check before sharing."
        : "    Project and file names are hidden. Add --names to include them.",
    ),
  );
  lines.push("");
  return lines.join("\n");
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
