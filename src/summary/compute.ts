/**
 * `inspecto` with no arguments: a 10-second answer to "how am I doing?".
 *
 * Each session is reduced to a small SessionDigest (spend, grade, cache
 * anomaly, retry status, fixable failure events); computeSummary turns the
 * digests into totals, the projects where spend went, and at most
 * MAX_ACTIONS concrete next steps. Pure — no I/O — so it is unit-testable.
 */

import type { FixEvent, FixFinding } from "../fix/types.js";
import type { MetricStatus } from "../parser/types.js";
import { buildFindings } from "../fix/detect.js";
import { gradeLetterFromScore } from "../metrics/grader.js";

export const MAX_ACTIONS = 3;
/** A session above this estimated cost counts as "expensive". */
export const EXPENSIVE_SESSION_USD = 50;
/** Expensive sessions only earn an action when they carry this share of spend. */
const EXPENSIVE_SHARE = 0.4;
/** A repeated failure must recur this often before it is worth a rule. */
const MIN_FAILURE_OCCURRENCES = 3;

export interface SessionDigest {
  sessionId: string;
  projectSlug: string;
  costUsd: number | null;
  score: number;
  cacheAnomaly: boolean;
  retryStatus: MetricStatus | null;
  events: FixEvent[];
}

export interface ProjectSpend {
  projectSlug: string;
  costUsd: number;
  sessions: number;
}

export type SummaryAction =
  /** `finding` is the largest instance; `projectSlugs` every project that hit it, largest first. */
  | { kind: "repeat-failure"; projectSlugs: string[]; finding: FixFinding }
  | { kind: "cache-anomaly"; sessions: number }
  | { kind: "expensive-sessions"; sessions: number; costUsd: number; share: number }
  | { kind: "retries"; sessions: number };

export interface Summary {
  sessions: number;
  projects: number;
  totalCostUsd: number;
  avgScore: number | null;
  avgLetter: string | null;
  topProjects: ProjectSpend[];
  actions: SummaryAction[];
}

export function computeSummary(digests: SessionDigest[]): Summary {
  const totalCostUsd = digests.reduce((sum, d) => sum + (d.costUsd ?? 0), 0);
  const avgScore = digests.length
    ? digests.reduce((sum, d) => sum + d.score, 0) / digests.length
    : null;

  const byProject = new Map<string, SessionDigest[]>();
  for (const d of digests) {
    const list = byProject.get(d.projectSlug) ?? [];
    list.push(d);
    byProject.set(d.projectSlug, list);
  }

  const topProjects: ProjectSpend[] = [...byProject.entries()]
    .map(([projectSlug, list]) => ({
      projectSlug,
      costUsd: list.reduce((sum, d) => sum + (d.costUsd ?? 0), 0),
      sessions: list.length,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.projectSlug.localeCompare(b.projectSlug))
    .slice(0, 3);

  return {
    sessions: digests.length,
    projects: byProject.size,
    totalCostUsd,
    avgScore,
    avgLetter: avgScore === null ? null : gradeLetterFromScore(avgScore),
    topProjects,
    actions: pickActions(digests, byProject, totalCostUsd),
  };
}

/**
 * Ordered by how directly the user can act on it: a repeated failure has a
 * one-command fix (`inspecto fix`), a cache anomaly has a known cause, long
 * expensive sessions are a habit, retries are the vaguest.
 */
function pickActions(
  digests: SessionDigest[],
  byProject: Map<string, SessionDigest[]>,
  totalCostUsd: number,
): SummaryAction[] {
  const actions: SummaryAction[] = [];

  // Findings are built per project because `inspecto fix` writes rules per
  // repo, then the same lesson across projects is merged into one action.
  const failures = [...byProject.entries()]
    .flatMap(([projectSlug, list]) =>
      buildFindings(list.map((d) => d.events), { minOccurrences: MIN_FAILURE_OCCURRENCES, limit: 2 })
        .map((finding) => ({ projectSlug, finding })),
    )
    .sort((a, b) => b.finding.occurrences - a.finding.occurrences || a.projectSlug.localeCompare(b.projectSlug));
  const byRule = new Map<string, { finding: FixFinding; projectSlugs: string[] }>();
  for (const { projectSlug, finding } of failures) {
    const merged = byRule.get(finding.ruleId);
    if (merged) merged.projectSlugs.push(projectSlug);
    else byRule.set(finding.ruleId, { finding, projectSlugs: [projectSlug] });
  }
  for (const { finding, projectSlugs } of [...byRule.values()].slice(0, 2)) {
    // Re-describe a merged lesson from every project's events so its counts
    // are the total, not just the largest project's.
    const total = projectSlugs.length === 1
      ? finding
      : buildFindings(
          projectSlugs.flatMap((slug) => byProject.get(slug)!.map((d) => d.events.filter((e) => e.ruleId === finding.ruleId))),
          { minOccurrences: 1 },
        )[0] ?? finding;
    actions.push({ kind: "repeat-failure", projectSlugs, finding: total });
  }

  const anomalies = digests.filter((d) => d.cacheAnomaly).length;
  if (anomalies > 0) actions.push({ kind: "cache-anomaly", sessions: anomalies });

  const expensive = digests.filter((d) => (d.costUsd ?? 0) >= EXPENSIVE_SESSION_USD);
  const expensiveCost = expensive.reduce((sum, d) => sum + (d.costUsd ?? 0), 0);
  if (expensive.length > 0 && totalCostUsd > 0 && expensiveCost / totalCostUsd >= EXPENSIVE_SHARE) {
    actions.push({
      kind: "expensive-sessions",
      sessions: expensive.length,
      costUsd: expensiveCost,
      share: expensiveCost / totalCostUsd,
    });
  }

  const retrying = digests.filter((d) => d.retryStatus === "critical").length;
  if (retrying > 0) actions.push({ kind: "retries", sessions: retrying });

  return actions.slice(0, MAX_ACTIONS);
}
