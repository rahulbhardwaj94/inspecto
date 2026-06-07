/**
 * M8: Subagent delegation ratio.
 *
 * Measures what fraction of total output tokens came from the main agent vs
 * subagents. A low main-agent ratio means the orchestrator delegated effectively.
 * Healthy = main agent produced < 60% of total output tokens.
 */

import type { MetricResult, Session } from "../parser/types.js";

export function computeSubagentOverhead(session: Session): MetricResult {
  if (session.subagentCount === 0) {
    return {
      name: "subagent-overhead",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No subagents in this session",
    };
  }

  let mainTokens = 0;
  let subagentTokens = 0;

  for (const turn of session.turns) {
    if (turn.role !== "assistant" || !turn.usage) continue;
    const out = turn.usage.output_tokens ?? 0;
    if (turn.agentId === undefined) {
      mainTokens += out;
    } else {
      subagentTokens += out;
    }
  }

  const total = mainTokens + subagentTokens;
  if (total === 0) {
    return {
      name: "subagent-overhead",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No output tokens recorded",
    };
  }

  const ratio = mainTokens / total;
  const status = ratio < 0.6 ? "healthy" : ratio < 0.8 ? "warning" : "critical";

  return {
    name: "subagent-overhead",
    value: Math.round(ratio * 100) / 100,
    status,
    label: `${Math.round(ratio * 100)}% main`,
  };
}
