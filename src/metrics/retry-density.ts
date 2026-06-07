/**
 * M5: Retry density.
 *
 * Measures how often the user sends messages very similar to their
 * previous message — a proxy for "Claude got it wrong and I'm asking again."
 */

import type { MetricResult, Session, TextBlock } from "../parser/types.js";
import { normalizedSimilarity } from "../utils/levenshtein.js";
import type { ThresholdConfig } from "../config/types.js";

export function computeRetryDensity(session: Session, thresholds?: ThresholdConfig): MetricResult {
  // Extract text from human-authored user turns only
  const humanTexts: string[] = [];
  for (const turn of session.turns) {
    if (!turn.isHumanTurn) continue;
    const text = turn.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    if (text.length > 0) humanTexts.push(text);
  }

  if (humanTexts.length < 2) {
    return {
      name: "retry-density",
      value: 0,
      status: "healthy",
      label: "0.00",
      detail: "Not enough user messages to detect retries",
    };
  }

  let retries = 0;
  const pairs = humanTexts.length - 1;

  for (let i = 0; i < pairs; i++) {
    const similarity = normalizedSimilarity(humanTexts[i], humanTexts[i + 1]);
    if (similarity > 0.6) {
      retries++;
    }
  }

  const density = retries / pairs;
  const { healthy, warning } = thresholds ?? { healthy: 0.1, warning: 0.25 };

  return {
    name: "retry-density",
    value: round(density),
    status: density <= healthy ? "healthy" : density <= warning ? "warning" : "critical",
    label: round(density).toString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
