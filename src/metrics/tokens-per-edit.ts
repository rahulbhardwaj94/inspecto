/**
 * M7: Tokens per useful edit.
 *
 * Total output tokens consumed divided by number of file modification
 * operations (Write + Edit). Rising ratio means Claude is burning more
 * tokens per productive action.
 */

import type { MetricResult, Session, ToolUseBlock } from "../parser/types.js";

const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export function computeTokensPerEdit(session: Session): MetricResult {
  let totalOutputTokens = 0;
  let editCount = 0;

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;

    // Count tokens from completed turns only
    if (turn.complete && turn.usage) {
      totalOutputTokens += turn.usage.output_tokens;
    }

    // Count edit operations
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const toolBlock = block as ToolUseBlock;
      if (EDIT_TOOLS.has(toolBlock.name)) editCount++;
    }
  }

  if (editCount === 0) {
    return {
      name: "tokens-per-edit",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No file modifications in this session",
    };
  }

  const ratio = totalOutputTokens / editCount;

  return {
    name: "tokens-per-edit",
    value: Math.round(ratio),
    status: ratio <= 5000 ? "healthy" : ratio <= 15000 ? "warning" : "critical",
    label: Math.round(ratio).toLocaleString("en-US"),
  };
}
