/**
 * M2: Full-file rewrite ratio.
 *
 * Ratio of Write calls (full file replacement) to total file modifications
 * (Write + Edit). Rising ratio means Claude is rewriting instead of
 * making surgical edits.
 */

import type { MetricResult, Session, ToolUseBlock } from "../parser/types.js";
import type { ThresholdConfig } from "../config/types.js";

export function computeRewriteRatio(session: Session, thresholds?: ThresholdConfig): MetricResult {
  let writes = 0;
  let edits = 0;

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;

    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as ToolUseBlock;

      if (toolBlock.name === "Write") writes++;
      else if (toolBlock.name === "Edit" || toolBlock.name === "NotebookEdit") edits++;
    }
  }

  const total = writes + edits;
  if (total === 0) {
    return {
      name: "rewrite-ratio",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No file modifications in this session",
    };
  }

  const ratio = writes / total;
  const { healthy, warning } = thresholds ?? { healthy: 0.25, warning: 0.5 };

  return {
    name: "rewrite-ratio",
    value: round(ratio),
    status: ratio <= healthy ? "healthy" : ratio <= warning ? "warning" : "critical",
    label: round(ratio).toString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
