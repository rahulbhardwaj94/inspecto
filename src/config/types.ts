export interface ThresholdConfig {
  healthy: number;
  warning: number;
}

export interface InspectoConfig {
  thresholds?: {
    readsPerEdit?: ThresholdConfig;
    rewriteRatio?: ThresholdConfig;
    cacheHitRate?: ThresholdConfig;
    taskCompletion?: ThresholdConfig;
    retryDensity?: ThresholdConfig;
    toolDiversity?: ThresholdConfig;
    tokensPerEdit?: ThresholdConfig;
    sessionCost?: ThresholdConfig;
  };
  weights?: {
    readsPerEdit?: number;
    rewriteRatio?: number;
    cacheHitRate?: number;
    taskCompletion?: number;
    retryDensity?: number;
    toolDiversity?: number;
    tokensPerEdit?: number;
  };
  dataDir?: string;
  defaultProject?: string;
}

export const DEFAULT_THRESHOLDS = {
  readsPerEdit: { healthy: 4.0, warning: 2.0 },
  rewriteRatio: { healthy: 0.25, warning: 0.40 },
  cacheHitRate: { healthy: 0.50, warning: 0.30 },
  taskCompletion: { healthy: 0.90, warning: 0.70 },
  retryDensity: { healthy: 0.10, warning: 0.20 },
  toolDiversity: { healthy: 0.60, warning: 0.40 },
  tokensPerEdit: { healthy: 5000, warning: 10000 },
  sessionCost: { healthy: 2.00, warning: 5.00 },
} satisfies Required<NonNullable<InspectoConfig["thresholds"]>>;

export const DEFAULT_WEIGHTS = {
  readsPerEdit: 0.14,
  rewriteRatio: 0.11,
  cacheHitRate: 0.11,
  taskCompletion: 0.10,
  retryDensity: 0.07,
  toolDiversity: 0.06,
  tokensPerEdit: 0.11,
} satisfies Required<NonNullable<InspectoConfig["weights"]>>;
