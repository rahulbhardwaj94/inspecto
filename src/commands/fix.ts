/**
 * Fix command — turn recurring session failures in this repo into CLAUDE.md
 * rules, and report whether rules applied earlier actually reduced them.
 *
 * Dry run by default: prints proposed rules. `--apply` writes them into the
 * managed block of CLAUDE.md with an applied timestamp the next run uses to
 * compare before/after.
 */

import chalk from "chalk";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { repoRoot } from "../outcomes/git.js";
import { extractEditedFilePaths, relativizeToRepo, tryRealpath } from "../outcomes/edited-files.js";
import { buildFindings, detectEvents } from "../fix/detect.js";
import { mergeRules, parseAppliedRules } from "../fix/claude-md.js";
import { MIN_SESSIONS_AFTER, verifyRules, type SessionEvents } from "../fix/verify.js";
import { parseDuration } from "../utils/duration.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { VERSION } from "../version.js";
import type { Session, SessionFile } from "../parser/types.js";
import type { FixFinding, RuleVerification } from "../fix/types.js";

const CONCURRENCY = 16;

export interface FixOptions {
  since?: string;
  apply?: boolean;
  file?: string;
  repo?: string;
  min?: string;
  json?: boolean;
  dataDir?: string;
  project?: string;
}

export async function runFix(options: FixOptions): Promise<void> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const project = options.project ?? config.defaultProject;
  const duration = options.since ?? "30d";
  const minOccurrences = Number(options.min ?? 2);
  if (!Number.isInteger(minOccurrences) || minOccurrences < 1) {
    throw new Error("--min must be a positive integer.");
  }

  const startDir = resolve(options.repo ?? process.cwd());
  const root = tryRealpath((await repoRoot(startDir)) ?? startDir);
  const claudeMdPath = options.file ? resolve(options.file) : join(root, "CLAUDE.md");

  const sessionFiles = await scanSessions({ dataDir, project, since: parseDuration(duration) });
  const settled = await concurrentSettled(sessionFiles, CONCURRENCY, async (sf: SessionFile) => {
    const session = await buildSession(
      readJsonl(sf.path),
      sf.sessionId,
      sf.projectSlug,
      sf.subagentPaths,
    );
    if (!sessionInRepo(session, root)) return null;
    return { startTime: session.startTime, events: detectEvents(session) } as SessionEvents;
  });

  const sessions = settled
    .filter((r): r is PromiseFulfilledResult<SessionEvents | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s): s is SessionEvents => s !== null);

  let content = "";
  try {
    content = await readFile(claudeMdPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const applied = parseAppliedRules(content);
  const appliedIds = new Set(applied.map((r) => r.ruleId));
  const verifications = verifyRules(applied, sessions);
  const findings = buildFindings(
    sessions.map((s) => s.events),
    { minOccurrences },
  ).filter((f) => !appliedIds.has(f.ruleId));

  let written = false;
  if (options.apply && findings.length > 0) {
    const merged = mergeRules(content, findings, new Date().toISOString());
    await writeFile(claudeMdPath, merged.content, "utf8");
    written = true;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { repo: root, claudeMd: claudeMdPath, sessionsAnalyzed: sessions.length, findings, verifications, written },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    renderFixReport({
      root,
      claudeMdPath,
      duration,
      sessionsAnalyzed: sessions.length,
      findings,
      verifications,
      written,
    }),
  );
}

/**
 * A session belongs to the repo if it started inside it or edited files in it.
 * The recorded cwd alone is unreliable (see edited-files.ts), so both count.
 */
export function sessionInRepo(session: Session, root: string): boolean {
  if (session.cwd && isInside(tryRealpath(session.cwd), root)) return true;
  return relativizeToRepo(extractEditedFilePaths(session), root).length > 0;
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

interface FixReport {
  root: string;
  claudeMdPath: string;
  duration: string;
  sessionsAnalyzed: number;
  findings: FixFinding[];
  verifications: RuleVerification[];
  written: boolean;
}

function renderFixReport(r: FixReport): string {
  const lines: string[] = [""];
  lines.push(chalk.bold(`  inspecto v${VERSION}`) + chalk.dim(" — Fix: lessons from past sessions"));
  lines.push(chalk.dim(`  Repo: ${r.root} · ${r.sessionsAnalyzed} sessions in the last ${r.duration}`));
  lines.push("");

  if (r.sessionsAnalyzed === 0) {
    lines.push(chalk.dim("  No sessions found for this repo. Run from inside the repo, or pass --repo <path>."));
    lines.push("");
    return lines.join("\n");
  }

  if (r.verifications.length > 0) {
    lines.push(chalk.bold("  Rules already applied"));
    for (const v of r.verifications) {
      lines.push(`    ${verdictBadge(v)} ${v.text || v.ruleId}`);
      lines.push(chalk.dim(`        ${verificationDetail(v)}`));
    }
    lines.push("");
  }

  if (r.findings.length === 0) {
    lines.push(chalk.green("  No new recurring failures found. Nothing to fix."));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(chalk.bold(r.written ? "  Rules added to CLAUDE.md" : "  Proposed rules"));
  r.findings.forEach((f, i) => {
    lines.push(`    ${chalk.cyan(`${i + 1}.`)} ${f.rule}`);
    lines.push(
      chalk.dim(`       ${f.evidence} (${f.occurrences}× across ${f.sessions} session${f.sessions === 1 ? "" : "s"})`),
    );
  });
  lines.push("");

  if (r.written) {
    lines.push(chalk.green(`  ✓ Wrote ${r.findings.length} rule${r.findings.length === 1 ? "" : "s"} to ${r.claudeMdPath}`));
    lines.push(
      chalk.dim(
        `    Review the diff and commit it. Run \`inspecto fix\` again after ${MIN_SESSIONS_AFTER}+ sessions to see whether each rule helped.`,
      ),
    );
  } else {
    lines.push(chalk.dim(`  Dry run. Write these to ${r.claudeMdPath} with:`));
    lines.push(`    ${chalk.bold("inspecto fix --apply")}`);
  }
  lines.push("");
  return lines.join("\n");
}

function verdictBadge(v: RuleVerification): string {
  switch (v.verdict) {
    case "working":
      return chalk.green("✓ working   ");
    case "worse":
      return chalk.red("✗ worse     ");
    case "no change":
      return chalk.yellow("~ no change ");
    case "no baseline":
      return chalk.dim("· no baseline");
    case "collecting data":
      return chalk.dim("… collecting");
  }
}

function verificationDetail(v: RuleVerification): string {
  const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(2));
  const since = `applied ${v.appliedAt.slice(0, 10)}`;
  if (v.verdict === "collecting data") {
    return `${since} · ${v.sessionsAfter}/${MIN_SESSIONS_AFTER} sessions since, need more before judging`;
  }
  if (v.verdict === "no baseline" && v.sessionsBefore === 0) {
    return `${since} · no sessions before it in this window; widen --since to compare`;
  }
  return `${since} · ${fmt(v.rateBefore)} → ${fmt(v.rateAfter)} per session (${v.sessionsBefore} before, ${v.sessionsAfter} after)`;
}
