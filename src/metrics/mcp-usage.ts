import type { MetricResult, Session, ToolUseBlock } from "../parser/types.js";

export function computeMcpUsage(session: Session): MetricResult {
  const assistantTurnsWithTools = session.turns.filter(
    (t) => t.role === "assistant" && t.content.some((b) => b.type === "tool_use")
  );

  if (assistantTurnsWithTools.length === 0) {
    return {
      name: "mcp-usage",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No tool use in this session",
    };
  }

  let mcpTurnCount = 0;

  for (const turn of assistantTurnsWithTools) {
    const hasMcpTool = turn.content.some(
      (b): b is ToolUseBlock =>
        b.type === "tool_use" && b.name.startsWith("mcp__")
    );

    const hasServerToolUse =
      (turn.usage?.server_tool_use?.web_search_requests ?? 0) > 0 ||
      (turn.usage?.server_tool_use?.web_fetch_requests ?? 0) > 0;

    if (hasMcpTool || hasServerToolUse) mcpTurnCount++;
  }

  const ratio = mcpTurnCount / assistantTurnsWithTools.length;

  return {
    name: "mcp-usage",
    value: round(ratio),
    status: "healthy",
    label: `${mcpTurnCount} turn${mcpTurnCount !== 1 ? "s" : ""}`,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
