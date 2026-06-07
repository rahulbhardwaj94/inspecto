/**
 * M1: Reads-before-edit ratio.
 *
 * Counts how many Read tool_use events occur before each Write or Edit event.
 * High values mean Claude is reading context before modifying files.
 * The AMD data showed this dropped from 6.6 to 2.0 after March 8.
 */

import type { MetricResult, Session, ToolUseBlock } from "../parser/types.js";
import type { ThresholdConfig } from "../config/types.js";

const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const READ_TOOL = "Read";

export function computeReadsPerEdit(session: Session, thresholds?: ThresholdConfig): MetricResult {
  let readsSinceLastEdit = 0;
  const ratios: number[] = [];

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;

    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as ToolUseBlock;

      if (toolBlock.name === READ_TOOL) {
        readsSinceLastEdit++;
      } else if (EDIT_TOOLS.has(toolBlock.name)) {
        ratios.push(readsSinceLastEdit);
        readsSinceLastEdit = 0;
      }
    }
  }

  if (ratios.length === 0) {
    return {
      name: "reads-per-edit",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No file modifications in this session",
    };
  }

  const average = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const { healthy, warning } = thresholds ?? { healthy: 4.0, warning: 2.0 };

  return {
    name: "reads-per-edit",
    value: round(average),
    status: average >= healthy ? "healthy" : average >= warning ? "warning" : "critical",
    label: round(average).toString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
