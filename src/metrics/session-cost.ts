import type { MetricResult, Session } from "../parser/types.js";

// Pricing per 1M tokens (Claude Sonnet 4.5/4.6)
const PRICE_PER_M = {
  output: 15.0,
  cacheCreation: 3.75,
  cacheRead: 0.30,
  input: 3.0,
};

export function computeSessionCost(session: Session): MetricResult {
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  for (const turn of session.turns) {
    if (!turn.usage) continue;
    outputTokens += turn.usage.output_tokens ?? 0;
    cacheCreationTokens += turn.usage.cache_creation_input_tokens ?? 0;
    cacheReadTokens += turn.usage.cache_read_input_tokens ?? 0;
  }

  const totalTokens = outputTokens + cacheCreationTokens + cacheReadTokens;
  if (totalTokens === 0) {
    return {
      name: "session-cost",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No token usage data in this session",
    };
  }

  const cost =
    (outputTokens * PRICE_PER_M.output +
      cacheCreationTokens * PRICE_PER_M.cacheCreation +
      cacheReadTokens * PRICE_PER_M.cacheRead) /
    1_000_000;

  return {
    name: "session-cost",
    value: round(cost),
    status: cost <= 2.0 ? "healthy" : cost <= 5.0 ? "warning" : "critical",
    label: `$${cost.toFixed(2)}`,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
