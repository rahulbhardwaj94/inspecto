import type { MetricResult, Session, ThinkingBlock } from "../parser/types.js";

export function computeThinkingUtilization(session: Session): MetricResult {
  const assistantTurns = session.turns.filter((t) => t.role === "assistant");

  const hasAnyToolUse = assistantTurns.some((t) =>
    t.content.some((b) => b.type === "tool_use")
  );

  if (!hasAnyToolUse) {
    return {
      name: "thinking-utilization",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No tool use in this session",
    };
  }

  const turnsWithThinking = assistantTurns.filter((t) =>
    t.content.some((b): b is ThinkingBlock => b.type === "thinking")
  ).length;

  if (turnsWithThinking === 0) {
    return {
      name: "thinking-utilization",
      value: 0,
      status: "critical",
      label: "0%",
      detail: "No extended thinking blocks detected",
    };
  }

  const ratio = Math.min(turnsWithThinking / assistantTurns.length, 1.0);

  return {
    name: "thinking-utilization",
    value: round(ratio),
    status: ratio >= 0.3 ? "healthy" : ratio >= 0.1 ? "warning" : "critical",
    label: `${(ratio * 100).toFixed(1)}%`,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
