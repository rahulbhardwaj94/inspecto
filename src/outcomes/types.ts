/**
 * Outcome verification types.
 *
 * An "outcome" links a graded session to what happened to its work in git:
 * which commits carried the session's edits, and how much of that code is
 * still alive at HEAD.
 */

export interface LinkedCommit {
  sha: string;
  subject: string;
  /** Unix epoch seconds of the commit. */
  timestamp: number;
  /** Files touched by both the commit and the session. */
  matchedFiles: string[];
  /** Lines added by this commit across matched files. */
  linesAdded: number;
  /** Lines from this commit still attributed to it at HEAD (across matched files). */
  linesSurviving: number;
}

export interface SessionOutcome {
  sessionId: string;
  projectSlug: string;
  cwd: string;
  /** Why the session couldn't be linked, or null if linking ran. */
  skippedReason: string | null;
  /** Repo-relative paths the session edited via Write/Edit/NotebookEdit. */
  editedFiles: string[];
  commits: LinkedCommit[];
  /** Sum of linesAdded across linked commits. */
  linesAdded: number;
  /** Sum of linesSurviving across linked commits. */
  linesSurviving: number;
  /** linesSurviving / linesAdded, or null when no lines were added. */
  survivalRate: number | null;
  /** Estimated session cost in USD (null when no usage data). */
  costUsd: number | null;
  /** costUsd / commits.length, or null when either side is missing. */
  costPerSurvivingChange: number | null;
}

export interface OutcomeAggregate {
  sessionsAnalyzed: number;
  sessionsLinked: number;
  /** sessionsLinked / sessions that had edits and a git repo. */
  linkRate: number | null;
  totalCommits: number;
  totalLinesAdded: number;
  totalLinesSurviving: number;
  avgSurvivalRate: number | null;
  totalCostUsd: number;
  /** Total cost of linked sessions / total linked commits. */
  costPerSurvivingChange: number | null;
}
