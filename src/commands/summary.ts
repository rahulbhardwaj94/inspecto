/**
 * Summary command — what `inspecto` prints with no arguments.
 *
 * One pass over the window's sessions: each is parsed once, graded (via the
 * grade cache), checked for cache anomalies and scanned for fixable failures,
 * then reduced to a SessionDigest for computeSummary.
 */

import chalk from "chalk";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { gradeSession } from "../metrics/grader.js";
import { getCachedGrade, setCachedGrade } from "../cache/grade-cache.js";
import { checkCacheAnomaly } from "../anomaly/cache-anomaly.js";
import { detectEvents } from "../fix/detect.js";
import { computeSummary, type SessionDigest, type Summary, type SummaryAction } from "../summary/compute.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { projectNameFromSlug } from "../utils/format.js";
import { feedbackCta } from "../reporter/cta.js";
import { VERSION } from "../version.js";
import type { SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;

export interface SummaryOptions {
  since?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runSummary(options: SummaryOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const since = options.since ?? "30d";

  const sessionFiles = await scanSessions({ dataDir, project, since: parseDuration(since) });
  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(
      readJsonl(sf.path),
      sf.sessionId,
      sf.projectSlug,
      sf.subagentPaths,
    );
    let grade = getCachedGrade(sf.path, sf.mtime);
    if (!grade) {
      grade = gradeSession(session, config);
      setCachedGrade(sf.path, sf.mtime, grade);
    }
    const metric = (name: string) => grade.metrics.find((m) => m.name === name);
    const retry = metric("retry-density");
    return {
      sessionId: session.id,
      projectSlug: session.projectSlug,
      costUsd: metric("session-cost")?.value ?? null,
      score: grade.score,
      cacheAnomaly: checkCacheAnomaly(session).isAnomaly,
      retryStatus: retry && retry.value !== null ? retry.status : null,
      events: detectEvents(session),
    } satisfies SessionDigest;
  });

  const digests = settled
    .filter((r): r is PromiseFulfilledResult<SessionDigest> => r.status === "fulfilled")
    .map((r) => r.value);
  const summary = computeSummary(digests);

  if (options.json) {
    console.log(JSON.stringify({ since, ...summary }, null, 2));
    return;
  }
  console.log(renderSummary(summary, since));
}

export function renderSummary(summary: Summary, since: string): string {
  const lines: string[] = [""];
  lines.push(chalk.bold(`  inspecto v${VERSION}`) + chalk.dim(` — your Claude Code sessions, last ${since}`));
  lines.push("");

  if (summary.sessions === 0) {
    lines.push(`  No sessions found in the last ${since}.`);
    lines.push(chalk.dim("  Use Claude Code for a bit, or widen the window: inspecto --since 90d"));
    lines.push("");
    return lines.join("\n");
  }

  const grade = summary.avgLetter
    ? `avg grade ${colorGrade(summary.avgLetter)} ${chalk.dim(`(${Math.round(summary.avgScore ?? 0)})`)}`
    : "";
  lines.push(
    `  ${plural(summary.sessions, "session")} · ${plural(summary.projects, "project")} · ` +
      `${chalk.bold(usd(summary.totalCostUsd))} ${chalk.dim("estimated")} · ${grade}`,
  );
  lines.push("");

  if (summary.totalCostUsd > 0) {
    lines.push(chalk.bold("  Where the spend went"));
    const width = Math.max(...summary.topProjects.map((p) => projectNameFromSlug(p.projectSlug).length));
    for (const p of summary.topProjects) {
      const share = Math.round((p.costUsd / summary.totalCostUsd) * 100);
      lines.push(
        `    ${projectNameFromSlug(p.projectSlug).padEnd(width)}  ${usd(p.costUsd).padStart(10)}  ` +
          chalk.dim(`${String(share).padStart(3)}% · ${plural(p.sessions, "session")}`),
      );
    }
    lines.push("");
  }

  if (summary.actions.length > 0) {
    lines.push(chalk.bold("  Fix these first"));
    summary.actions.forEach((action, i) => {
      const [what, how] = describeAction(action);
      lines.push(`    ${chalk.yellow(`${i + 1}.`)} ${what}`);
      lines.push(`       ${chalk.dim("→")} ${how}`);
    });
  } else {
    lines.push(chalk.green("  Nothing urgent: no repeated failures, cache problems or runaway sessions."));
  }
  lines.push("");

  lines.push(chalk.bold("  Go deeper"));
  lines.push(`    ${chalk.cyan("inspecto audit")}                ${chalk.dim("grade your latest session metric by metric")}`);
  lines.push(`    ${chalk.cyan("inspecto statusline install")}   ${chalk.dim("live grade and cost in Claude Code's status bar")}`);
  lines.push(`    ${chalk.cyan("inspecto wrapped")}              ${chalk.dim("your year in Claude Code as shareable cards")}`);
  lines.push(`    ${chalk.cyan("inspecto --help")}               ${chalk.dim("every command")}`);
  lines.push("");

  const cta = feedbackCta();
  if (cta) {
    lines.push(cta);
    lines.push("");
  }
  return lines.join("\n");
}

function describeAction(action: SummaryAction): [string, string] {
  switch (action.kind) {
    case "repeat-failure":
      return [
        `${action.finding.evidence} ${chalk.dim(`(${projectList(action.projectSlugs)})`)}`,
        `run ${chalk.cyan("inspecto fix --apply")} in ${action.projectSlugs.length === 1 ? "that repo" : "each repo"} to add a CLAUDE.md rule; later runs report whether it helped`,
      ];
    case "cache-anomaly":
      return [
        `${plural(action.sessions, "session")} had a near-zero prompt cache hit rate, so every turn paid full input price.`,
        `run ${chalk.cyan("inspecto cache-check --since 30d")} to see which; updating Claude Code usually fixes it`,
      ];
    case "expensive-sessions":
      return [
        `${plural(action.sessions, "session")} cost over $50 each — ${usd(action.costUsd)}, ${Math.round(action.share * 100)}% of your spend.`,
        "every turn re-sends the whole conversation, so long sessions get pricier per turn; start a fresh session (/clear) between tasks",
      ];
    case "retries":
      return [
        `In ${plural(action.sessions, "session")} you rephrased the same request again and again.`,
        "put the requirements that keep getting missed into CLAUDE.md, or split the task into smaller asks",
      ];
  }
}

function projectList(slugs: string[]): string {
  const names = slugs.map(projectNameFromSlug);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function colorGrade(letter: string): string {
  if (letter.startsWith("A")) return chalk.green(letter);
  if (letter.startsWith("B")) return chalk.cyan(letter);
  if (letter.startsWith("C")) return chalk.yellow(letter);
  return chalk.red(letter);
}
