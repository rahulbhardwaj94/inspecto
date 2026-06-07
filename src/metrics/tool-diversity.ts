/**
 * M6: Tool diversity score.
 *
 * Shannon entropy over the distribution of tool_use events by tool name.
 * Normalized to 0-1. Low diversity means Claude is over-relying on
 * one tool (often Write).
 */

import type { MetricResult, Session, ToolUseBlock } from "../parser/types.js";
import type { ThresholdConfig } from "../config/types.js";

export function computeToolDiversity(session: Session, thresholds?: ThresholdConfig): MetricResult {
  const toolCounts = new Map<string, number>();

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;

    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as ToolUseBlock;
      toolCounts.set(toolBlock.name, (toolCounts.get(toolBlock.name) ?? 0) + 1);
    }
  }

  const uniqueTools = toolCounts.size;
  if (uniqueTools <= 1) {
    return {
      name: "tool-diversity",
      value: uniqueTools === 0 ? null : 0,
      status: uniqueTools === 0 ? "healthy" : "critical",
      label: uniqueTools === 0 ? "N/A" : "0.00",
      detail: uniqueTools === 0
        ? "No tool usage in this session"
        : `Only one tool used: ${[...toolCounts.keys()][0]}`,
    };
  }

  const totalCalls = [...toolCounts.values()].reduce((a, b) => a + b, 0);
  const maxEntropy = Math.log2(uniqueTools);

  let entropy = 0;
  for (const count of toolCounts.values()) {
    const p = count / totalCalls;
    entropy -= p * Math.log2(p);
  }

  const normalized = entropy / maxEntropy;

  // Build detail showing top tools
  const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topTool = sorted[0];
  const topPercent = Math.round((topTool[1] / totalCalls) * 100);
  const detail = `Most used: ${topTool[0]} (${topPercent}%)`;

  const { healthy, warning } = thresholds ?? { healthy: 0.6, warning: 0.4 };

  return {
    name: "tool-diversity",
    value: round(normalized),
    status: normalized >= healthy ? "healthy" : normalized >= warning ? "warning" : "critical",
    label: round(normalized).toString(),
    detail,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
