import type { MetricResult, Session, ToolResultBlock } from "../parser/types.js";

export function computeToolErrorRate(session: Session): MetricResult {
  let totalResults = 0;
  let errorResults = 0;

  for (const turn of session.turns) {
    for (const block of turn.content) {
      if (block.type !== "tool_result") continue;
      const resultBlock = block as ToolResultBlock;
      totalResults++;
      if (resultBlock.is_error === true) errorResults++;
    }
  }

  if (totalResults === 0) {
    return {
      name: "tool-error-rate",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No tool calls in this session",
    };
  }

  const rate = errorResults / totalResults;

  return {
    name: "tool-error-rate",
    value: round(rate),
    status: rate <= 0.05 ? "healthy" : rate <= 0.15 ? "warning" : "critical",
    label: `${(rate * 100).toFixed(1)}%`,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
