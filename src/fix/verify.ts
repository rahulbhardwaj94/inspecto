/**
 * Measures whether each applied rule reduced the failure it was written for:
 * occurrences per session before vs after the rule's applied timestamp.
 *
 * Claude Code reads CLAUDE.md at session start, so a session counts as
 * "after" only if it started after the rule was applied.
 */

import type { AppliedRule, FixEvent, RuleVerification } from "./types.js";

/** Sessions needed after a rule lands before judging it. */
export const MIN_SESSIONS_AFTER = 3;

export interface SessionEvents {
  startTime: string;
  events: FixEvent[];
}

export function verifyRules(rules: AppliedRule[], sessions: SessionEvents[]): RuleVerification[] {
  return rules.map((rule) => verifyRule(rule, sessions));
}

function verifyRule(rule: AppliedRule, sessions: SessionEvents[]): RuleVerification {
  const appliedMs = Date.parse(rule.appliedAt);
  let sessionsBefore = 0;
  let sessionsAfter = 0;
  let eventsBefore = 0;
  let eventsAfter = 0;

  for (const s of sessions) {
    const start = Date.parse(s.startTime);
    if (Number.isNaN(start) || Number.isNaN(appliedMs)) continue;
    const count = s.events.filter((e) => e.ruleId === rule.ruleId).length;
    if (start < appliedMs) {
      sessionsBefore++;
      eventsBefore += count;
    } else {
      sessionsAfter++;
      eventsAfter += count;
    }
  }

  const rateBefore = sessionsBefore > 0 ? eventsBefore / sessionsBefore : null;
  const rateAfter = sessionsAfter > 0 ? eventsAfter / sessionsAfter : null;

  return {
    ruleId: rule.ruleId,
    appliedAt: rule.appliedAt,
    text: rule.text,
    sessionsBefore,
    sessionsAfter,
    rateBefore,
    rateAfter,
    verdict: verdictFor(rateBefore, rateAfter, sessionsAfter),
  };
}

function verdictFor(
  before: number | null,
  after: number | null,
  sessionsAfter: number,
): RuleVerification["verdict"] {
  if (sessionsAfter < MIN_SESSIONS_AFTER || after === null) return "collecting data";
  if (before === null || before === 0) return "no baseline";
  if (after <= before * 0.5) return "working";
  if (after > before * 1.2) return "worse";
  return "no change";
}
