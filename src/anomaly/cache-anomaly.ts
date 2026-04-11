/**
 * Cache hit rate anomaly detection.
 *
 * Specifically checks for the prompt cache bug that caused 10-20x
 * token cost inflation by detecting sessions with near-zero cache hit rates.
 */

import type { Session } from "../parser/types.js";
import { computeCacheHitRate } from "../metrics/cache-hit-rate.js";

export interface CacheCheckResult {
  sessionId: string;
  projectSlug: string;
  timestamp: string;
  cacheHitRate: number | null;
  isAnomaly: boolean;
  estimatedInflation: number | null;
}

const ANOMALY_THRESHOLD = 0.05;
const NORMAL_CACHE_RATE = 0.65;

/**
 * Check a single session for cache hit rate anomalies.
 */
export function checkCacheAnomaly(session: Session): CacheCheckResult {
  const metric = computeCacheHitRate(session);

  const isAnomaly = metric.value !== null && metric.value < ANOMALY_THRESHOLD;

  let estimatedInflation: number | null = null;
  if (isAnomaly && metric.value !== null) {
    // If normal rate is 65% cache reads, the effective input cost multiplier
    // when cache is broken is roughly 1 / (1 - normalRate)
    // Normal: 35% full-price tokens. Broken: 100% full-price tokens.
    estimatedInflation = Math.round(1 / (1 - NORMAL_CACHE_RATE));
  }

  return {
    sessionId: session.id,
    projectSlug: session.projectSlug,
    timestamp: session.startTime,
    cacheHitRate: metric.value,
    isAnomaly,
    estimatedInflation,
  };
}
