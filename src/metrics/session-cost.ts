import type { MetricResult, Session, UsageData } from "../parser/types.js";
import type { ThresholdConfig } from "../config/types.js";

/** USD per million tokens. Source: Anthropic model pricing, checked 2026-07-14. */
interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const SONNET_5_INTRO: ModelPricing = {
  input: 2,
  output: 10,
  cacheWrite5m: 2.5,
  cacheWrite1h: 4,
  cacheRead: 0.2,
};

const SONNET_STANDARD: ModelPricing = {
  input: 3,
  output: 15,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6,
  cacheRead: 0.3,
};

const OPUS_45_PLUS: ModelPricing = {
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
};

const HAIKU_45: ModelPricing = {
  input: 1,
  output: 5,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
  cacheRead: 0.1,
};

const FABLE_OR_MYTHOS_5: ModelPricing = {
  input: 10,
  output: 50,
  cacheWrite5m: 12.5,
  cacheWrite1h: 20,
  cacheRead: 1,
};

const SONNET_5_STANDARD_START = Date.parse("2026-09-01T00:00:00Z");

export function computeSessionCost(session: Session, thresholds?: ThresholdConfig): MetricResult {
  let cost = 0;
  let totalTokens = 0;
  let usedFallback = false;

  for (const turn of session.turns) {
    if (!turn.usage) continue;
    const model = turn.model || session.model;
    const resolved = resolvePricing(model, session.startTime);
    usedFallback ||= resolved.fallback;
    cost += costUsage(turn.usage, resolved.pricing);
    totalTokens += tokenCount(turn.usage);
  }

  if (totalTokens === 0) {
    return {
      name: "session-cost",
      value: null,
      status: "healthy",
      label: "N/A",
      detail: "No token usage data in this session",
    };
  }

  const { healthy, warning } = thresholds ?? { healthy: 2.0, warning: 5.0 };

  return {
    name: "session-cost",
    value: round(cost),
    status: cost <= healthy ? "healthy" : cost <= warning ? "warning" : "critical",
    label: `$${cost.toFixed(2)}`,
    detail: usedFallback
      ? "Estimate uses Sonnet 4.6 pricing for at least one unrecognized model; verify against Anthropic billing"
      : "Model-aware estimate from recorded token usage; verify against Anthropic billing",
  };
}

function resolvePricing(model: string, sessionStart: string): { pricing: ModelPricing; fallback: boolean } {
  const normalized = model.toLowerCase();

  if (normalized.includes("sonnet-5")) {
    const startedAt = Date.parse(sessionStart);
    return {
      pricing:
        Number.isFinite(startedAt) && startedAt >= SONNET_5_STANDARD_START
          ? SONNET_STANDARD
          : SONNET_5_INTRO,
      fallback: false,
    };
  }

  if (/opus-4-(5|6|7|8)/.test(normalized)) {
    return { pricing: OPUS_45_PLUS, fallback: false };
  }

  if (normalized.includes("sonnet-4")) {
    return { pricing: SONNET_STANDARD, fallback: false };
  }

  if (normalized.includes("haiku-4-5")) {
    return { pricing: HAIKU_45, fallback: false };
  }

  if (normalized.includes("fable-5") || normalized.includes("mythos-5")) {
    return { pricing: FABLE_OR_MYTHOS_5, fallback: false };
  }

  return { pricing: SONNET_STANDARD, fallback: true };
}

function costUsage(usage: UsageData, pricing: ModelPricing): number {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const oneHour = Math.min(
    cacheCreation,
    usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  );
  const reportedFiveMinute = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const fiveMinute = Math.min(cacheCreation - oneHour, reportedFiveMinute);
  // Older Claude Code logs expose only the aggregate. Treat any remainder as a
  // 5-minute write, matching Anthropic's default cache duration.
  const unclassifiedCacheWrite = Math.max(0, cacheCreation - oneHour - fiveMinute);

  return (
    ((usage.input_tokens ?? 0) * pricing.input +
      (usage.output_tokens ?? 0) * pricing.output +
      (fiveMinute + unclassifiedCacheWrite) * pricing.cacheWrite5m +
      oneHour * pricing.cacheWrite1h +
      (usage.cache_read_input_tokens ?? 0) * pricing.cacheRead) /
    1_000_000
  );
}

function tokenCount(usage: UsageData): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
