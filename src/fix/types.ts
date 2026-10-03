/**
 * Types for `inspecto fix` — turning recurring session failures into
 * CLAUDE.md rules, then measuring whether each rule helped.
 */

export type FixKind =
  | "command-correction"
  | "failing-command"
  | "edit-before-read"
  | "stale-edit"
  | "missing-path";

/** One occurrence of a fixable failure inside one session. */
export interface FixEvent {
  /** Stable id shared by every occurrence of the same lesson. */
  ruleId: string;
  kind: FixKind;
  /** Bash: the failed command. Path errors: the path. */
  subject: string;
  /** Bash corrections: the command that worked instead. */
  replacement?: string;
  /** First meaningful line of the error output. */
  errorLine?: string;
}

/** A lesson worth writing down: recurring events grouped by ruleId. */
export interface FixFinding {
  ruleId: string;
  kind: FixKind;
  /** The rule text that goes into CLAUDE.md. */
  rule: string;
  /** Human-readable evidence shown in the terminal, not written to the file. */
  evidence: string;
  occurrences: number;
  sessions: number;
}

/** A rule already present in CLAUDE.md, parsed from its marker comment. */
export interface AppliedRule {
  ruleId: string;
  appliedAt: string;
  /** The rule text on the marker's line, as currently written. */
  text: string;
}

export type FixVerdict = "working" | "no change" | "worse" | "collecting data" | "no baseline";

export interface RuleVerification {
  ruleId: string;
  appliedAt: string;
  text: string;
  sessionsBefore: number;
  sessionsAfter: number;
  /** Occurrences per session before/after the rule was applied. */
  rateBefore: number | null;
  rateAfter: number | null;
  verdict: FixVerdict;
}
