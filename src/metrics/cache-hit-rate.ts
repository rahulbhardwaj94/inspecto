/**
 * M3: Cache hit rate.
 *
 * Ratio of cache_read_input_tokens to total input tokens
 * (cache_read + cache_creation). Detects the prompt cache bug
 * that caused 10-20x cost inflation.
 *
 * Note: raw `input_tokens` is always a streaming placeholder (1 or 3).
 * Real input cost = cache_read + cache_creation.
 */

import type { MetricResult, Session } from "../parser/types.js";
import type { ThresholdConfig } from "../config/types.js";

export function computeCacheHitRate(session: Session, thresholds?: ThresholdConfig): MetricResult {
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  for (const turn of session.turns) {
    if (turn.role !== "assistant" || !turn.usage || !turn.complete) continue;

    totalCacheRead += turn.usage.cache_read_input_tokens;
    totalCacheCreation += turn.usage.cache_creation_input_tokens;
  }

  const totalInput = totalCacheRead + totalCacheCreation;
  if (totalInput === 0) {
    return {
      name: "cache-hit-rate",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No token usage data available",
    };
  }

  const rate = totalCacheRead / totalInput;
  const { healthy, warning } = thresholds ?? { healthy: 0.5, warning: 0.2 };

  return {
    name: "cache-hit-rate",
    value: round(rate),
    status: rate >= healthy ? "healthy" : rate >= warning ? "warning" : "critical",
    label: round(rate).toString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
