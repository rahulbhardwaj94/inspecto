/**
 * Statusline summary — the few numbers worth glancing at mid-session, plus
 * at most one nudge, rendered as a single line for Claude Code's status bar.
 *
 * `summarizeSession` is the expensive part (grading); its result is cached
 * per transcript size/mtime by the command. `renderStatusline` is cheap and
 * pure so the live cost from Claude Code can be merged in on every refresh.
 */

import { Chalk } from "chalk";
import { gradeSession } from "../metrics/grader.js";
import { detectEvents } from "../fix/detect.js";
import type { MetricStatus, Session } from "../parser/types.js";
import type { InspectoConfig } from "../config/types.js";

/** Below this many assistant turns the grade is noise, so it's hidden. */
export const MIN_TURNS_FOR_GRADE = 3;

export interface StatuslineSummary {
  assistantTurns: number;
  letter: string;
  score: number;
  costUsd: number | null;
  cacheRate: number | null;
  cacheStatus: MetricStatus;
  nudge: string | null;
}

export function summarizeSession(session: Session, config?: InspectoConfig): StatuslineSummary {
  const grade = gradeSession(session, config);
  const metric = (name: string) => grade.metrics.find((m) => m.name === name);
  const cache = metric("cache-hit-rate");

  return {
    assistantTurns: session.turns.filter((t) => t.role === "assistant").length,
    letter: grade.letter,
    score: grade.score,
    costUsd: metric("session-cost")?.value ?? null,
    cacheRate: cache?.value ?? null,
    cacheStatus: cache?.status ?? "healthy",
    nudge: pickNudge(session, grade.metrics),
  };
}

/** The single most useful thing to say right now, or null. Most specific first. */
function pickNudge(
  session: Session,
  metrics: ReturnType<typeof gradeSession>["metrics"],
): string | null {
  // A failure repeating within this session is exactly what `inspecto fix` turns into a rule.
  const counts = new Map<string, { n: number; kind: string; subject: string }>();
  for (const e of detectEvents(session)) {
    const c = counts.get(e.ruleId) ?? { n: 0, kind: e.kind, subject: e.subject };
    c.n++;
    counts.set(e.ruleId, c);
  }
  const repeat = [...counts.values()].filter((c) => c.n >= 2).sort((a, b) => b.n - a.n)[0];
  if (repeat) {
    const what =
      repeat.kind === "command-correction" || repeat.kind === "failing-command"
        ? `\`${truncate(repeat.subject, 28)}\` failed ${repeat.n}×`
        : `${repeat.n}× ${KIND_LABELS[repeat.kind] ?? "repeat errors"}`;
    return `${what} · inspecto fix`;
  }

  const retry = metrics.find((m) => m.name === "retry-density");
  if (retry && retry.status === "critical") return "↻ rephrasing a lot · try /clear";

  const errors = metrics.find((m) => m.name === "tool-error-rate");
  if (errors && errors.status === "critical") return `⚠ ${errors.label} tool errors`;

  return null;
}

const KIND_LABELS: Record<string, string> = {
  "edit-before-read": "edit before read",
  "stale-edit": "stale edits",
  "missing-path": "missing paths",
};

export interface RenderOptions {
  /** Authoritative session cost reported by Claude Code, when available. */
  liveCostUsd?: number | null;
  color?: boolean;
}

export function renderStatusline(summary: StatuslineSummary, options: RenderOptions = {}): string {
  const c = new Chalk({ level: options.color === false ? 0 : 1 });
  const parts: string[] = [];

  if (summary.assistantTurns < MIN_TURNS_FOR_GRADE) {
    parts.push(c.dim("inspecto · warming up"));
  } else {
    parts.push(`inspecto ${gradeColor(c, summary.score)(`${summary.letter} ${summary.score}`)}`);
  }

  const cost = options.liveCostUsd ?? summary.costUsd;
  if (cost !== null && cost !== undefined) parts.push(`$${cost.toFixed(2)}`);

  if (summary.cacheRate !== null && summary.assistantTurns >= MIN_TURNS_FOR_GRADE) {
    parts.push(statusColor(c, summary.cacheStatus)(`cache ${Math.round(summary.cacheRate * 100)}%`));
  }

  if (summary.nudge) parts.push(c.yellow(summary.nudge));

  return parts.join(c.dim(" · "));
}

function gradeColor(c: InstanceType<typeof Chalk>, score: number) {
  if (score >= 80) return c.green;
  if (score >= 67) return c.yellow;
  return c.red;
}

function statusColor(c: InstanceType<typeof Chalk>, status: MetricStatus) {
  if (status === "healthy") return c.green;
  if (status === "warning") return c.yellow;
  return c.red;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
