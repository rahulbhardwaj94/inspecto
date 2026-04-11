/**
 * Contextual tips based on metric values.
 * Maps poor-scoring metrics to actionable suggestions.
 */

import type { MetricResult } from "../parser/types.js";

const TIPS: Record<string, Record<string, string>> = {
  "reads-per-edit": {
    warning: "Claude is editing with less context. Add 'Always read files before editing' to your CLAUDE.md.",
    critical: "Very low reads before edits. Claude is making blind changes. Consider adding explicit read instructions.",
  },
  "rewrite-ratio": {
    warning: "High ratio of full-file rewrites. Add 'Prefer Edit over Write for existing files' to CLAUDE.md.",
    critical: "Claude is rewriting entire files instead of making surgical edits. This wastes tokens and risks data loss.",
  },
  "cache-hit-rate": {
    warning: "Cache hit rate is below normal. Sessions may be too short for caching to help.",
    critical: "Very low cache hit rate — possible cache bug. Try restarting Claude Code or downgrading to a previous version.",
  },
  "task-completion": {
    warning: "Claude is occasionally promising actions without following through.",
    critical: "Frequent unfulfilled promises. Claude says it will do things but doesn't. Try breaking tasks into smaller steps.",
  },
  "retry-density": {
    warning: "Some user messages look like retries. Claude may be misunderstanding requests.",
    critical: "High retry rate. Users are frequently re-asking. Consider providing more context in prompts.",
  },
  "tool-diversity": {
    warning: "Low tool diversity. Claude is over-relying on a narrow set of tools.",
    critical: "Very narrow tool usage. Claude may be stuck in a pattern. Try prompting for specific tool usage.",
  },
  "tokens-per-edit": {
    warning: "Tokens per edit is above average. Claude may be verbose without being productive.",
    critical: "Very high token cost per edit. Claude is burning tokens without proportional output.",
  },
};

export function getTip(metric: MetricResult): string | null {
  if (metric.status === "healthy") return null;

  const metricTips = TIPS[metric.name];
  if (!metricTips) return null;

  return metricTips[metric.status] ?? null;
}

export function getAllTips(metrics: MetricResult[]): string[] {
  return metrics
    .map(getTip)
    .filter((tip): tip is string => tip !== null);
}
