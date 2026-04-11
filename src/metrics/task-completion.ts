/**
 * M4: Task completion rate.
 *
 * Detects sessions where Claude says it will do something but doesn't
 * follow through. Looks for intent phrases in assistant text that
 * aren't followed by a tool_use in the next assistant turn.
 */

import type { MetricResult, Session, MergedTurn, TextBlock, ToolUseBlock } from "../parser/types.js";

const INTENT_PATTERNS = [
  /\bI'll now\b/i,
  /\bLet me\b/i,
  /\bI'll update\b/i,
  /\bNext,? I'll\b/i,
  /\bI'll (?:also |then )?(?:fix|add|create|implement|refactor|modify|change|write|edit|update)\b/i,
  /\bI'm going to\b/i,
];

export function computeTaskCompletion(session: Session): MetricResult {
  const assistantTurns = session.turns.filter(
    (t) => t.role === "assistant" && t.complete,
  );

  let totalIntents = 0;
  let unfulfilledIntents = 0;

  for (const turn of assistantTurns) {
    const hasIntent = hasIntentPhrase(turn);
    if (!hasIntent) continue;

    totalIntents++;

    // An intent is fulfilled if the same merged turn also contains a tool_use.
    // Since streaming chunks are merged, a real action within this turn means
    // Claude followed through. An intent without a tool_use in the same turn
    // is a dangling promise.
    const hasToolUse = turn.content.some((b) => b.type === "tool_use");
    if (!hasToolUse) {
      unfulfilledIntents++;
    }
  }

  if (totalIntents === 0) {
    return {
      name: "task-completion",
      value: 1,
      status: "healthy",
      label: "1.00",
      detail: "No intent phrases detected",
    };
  }

  const rate = 1 - unfulfilledIntents / totalIntents;

  return {
    name: "task-completion",
    value: round(rate),
    status: rate >= 0.9 ? "healthy" : rate >= 0.7 ? "warning" : "critical",
    label: round(rate).toString(),
  };
}

function hasIntentPhrase(turn: MergedTurn): boolean {
  for (const block of turn.content) {
    if (block.type === "text") {
      const textBlock = block as TextBlock;
      if (INTENT_PATTERNS.some((p) => p.test(textBlock.text))) {
        return true;
      }
    }
  }
  return false;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
