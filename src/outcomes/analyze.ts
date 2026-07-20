/**
 * Outcome analysis: link a session to the git commits that carried its work,
 * then measure how much of that work is still alive at HEAD.
 *
 * Linking: commits in [session start, session end + 24h] that touch at least
 * one file the session edited. Survival: lines added by a linked commit that
 * `git blame HEAD` still attributes to it (one blame pass per file, shared
 * across commits).
 */

import { dirname } from "node:path";
import {
  blameAttribution,
  commitAdditions,
  listCommits,
  repoRoot,
} from "./git.js";
import {
  extractEditedFilePaths,
  relativizeToRepo,
  tryRealpath,
} from "./edited-files.js";
import { computeSessionCost } from "../metrics/session-cost.js";
import type { Session } from "../parser/types.js";
import type { LinkedCommit, OutcomeAggregate, SessionOutcome } from "./types.js";

/** Commits landing up to this long after the session still count as its work. */
const COMMIT_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

export async function analyzeSessionOutcome(session: Session): Promise<SessionOutcome> {
  const costUsd = computeSessionCost(session).value;

  const base: SessionOutcome = {
    sessionId: session.id,
    projectSlug: session.projectSlug,
    cwd: session.cwd,
    skippedReason: null,
    editedFiles: [],
    commits: [],
    linesAdded: 0,
    linesSurviving: 0,
    survivalRate: null,
    costUsd,
    costPerSurvivingChange: null,
  };

  // Resolve the repository from the files the session actually edited. A
  // session's recorded cwd is only the FIRST directory seen and is often stale
  // (renamed/deleted dirs, cd-ing between repos), so it is a fallback only.
  const absoluteEdits = extractEditedFilePaths(session);
  if (absoluteEdits.length === 0) {
    return { ...base, skippedReason: "no file edits in this session" };
  }

  const candidateDirs = new Set(absoluteEdits.map((f) => dirname(f)));
  if (session.cwd) candidateDirs.add(session.cwd);

  const roots = new Set<string>();
  for (const dir of candidateDirs) {
    const resolved = await repoRoot(dir);
    if (resolved) roots.add(tryRealpath(resolved));
  }
  if (roots.size === 0) {
    return { ...base, skippedReason: "not a git repository" };
  }

  // A session can touch several repos; analyze the one holding the most edits.
  let root = "";
  let editedFiles: string[] = [];
  for (const candidate of roots) {
    const relative = relativizeToRepo(absoluteEdits, candidate);
    if (relative.length > editedFiles.length) {
      root = candidate;
      editedFiles = relative;
    }
  }
  base.cwd = root;
  base.editedFiles = editedFiles;
  if (editedFiles.length === 0) {
    return { ...base, skippedReason: "no edited files inside a git repository" };
  }
  if (!session.startTime || !session.endTime) {
    return { ...base, skippedReason: "session has no timestamps" };
  }

  const sinceEpoch = Math.floor(new Date(session.startTime).getTime() / 1000);
  const untilEpoch = Math.floor(
    (new Date(session.endTime).getTime() + COMMIT_WINDOW_AFTER_MS) / 1000,
  );

  const editedSet = new Set(editedFiles);
  const candidates = (await listCommits(root, sinceEpoch, untilEpoch)).filter((c) =>
    c.files.some((f) => editedSet.has(f)),
  );
  if (candidates.length === 0) {
    return base; // linking ran, nothing matched — a real (negative) result
  }

  // One blame pass per involved file, shared across all linked commits.
  const involvedFiles = new Set<string>();
  for (const c of candidates) {
    for (const f of c.files) if (editedSet.has(f)) involvedFiles.add(f);
  }
  const blameByFile = new Map<string, Map<string, number>>();
  for (const file of involvedFiles) {
    blameByFile.set(file, await blameAttribution(root, file));
  }

  const commits: LinkedCommit[] = [];
  for (const candidate of candidates) {
    const matchedFiles = candidate.files.filter((f) => editedSet.has(f));
    const additions = await commitAdditions(root, candidate.sha);

    let linesAdded = 0;
    let linesSurviving = 0;
    for (const file of matchedFiles) {
      linesAdded += additions.get(file) ?? 0;
      linesSurviving += blameByFile.get(file)?.get(candidate.sha) ?? 0;
    }
    // Blame can attribute context/moved lines; never report >100% survival.
    linesSurviving = Math.min(linesSurviving, linesAdded);

    commits.push({
      sha: candidate.sha,
      subject: candidate.subject,
      timestamp: candidate.timestamp,
      matchedFiles,
      linesAdded,
      linesSurviving,
    });
  }

  const linesAdded = commits.reduce((sum, c) => sum + c.linesAdded, 0);
  const linesSurviving = commits.reduce((sum, c) => sum + c.linesSurviving, 0);

  return {
    ...base,
    commits,
    linesAdded,
    linesSurviving,
    survivalRate: linesAdded > 0 ? linesSurviving / linesAdded : null,
    costPerSurvivingChange:
      costUsd !== null && commits.length > 0 ? costUsd / commits.length : null,
  };
}

export function aggregateOutcomes(outcomes: SessionOutcome[]): OutcomeAggregate {
  const linkable = outcomes.filter((o) => o.skippedReason === null);
  const linked = linkable.filter((o) => o.commits.length > 0);

  const totalCommits = linked.reduce((sum, o) => sum + o.commits.length, 0);
  const totalLinesAdded = linked.reduce((sum, o) => sum + o.linesAdded, 0);
  const totalLinesSurviving = linked.reduce((sum, o) => sum + o.linesSurviving, 0);
  const linkedCost = linked.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);
  const totalCost = outcomes.reduce((sum, o) => sum + (o.costUsd ?? 0), 0);

  return {
    sessionsAnalyzed: outcomes.length,
    sessionsLinked: linked.length,
    linkRate: linkable.length > 0 ? linked.length / linkable.length : null,
    totalCommits,
    totalLinesAdded,
    totalLinesSurviving,
    avgSurvivalRate: totalLinesAdded > 0 ? totalLinesSurviving / totalLinesAdded : null,
    totalCostUsd: totalCost,
    costPerSurvivingChange: totalCommits > 0 ? linkedCost / totalCommits : null,
  };
}
