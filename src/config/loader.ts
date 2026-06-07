import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InspectoConfig } from "./types.js";

const KNOWN_THRESHOLD_KEYS = new Set([
  "readsPerEdit", "rewriteRatio", "cacheHitRate", "taskCompletion",
  "retryDensity", "toolDiversity", "tokensPerEdit", "sessionCost",
]);

const KNOWN_WEIGHT_KEYS = new Set([
  "readsPerEdit", "rewriteRatio", "cacheHitRate", "taskCompletion",
  "retryDensity", "toolDiversity", "tokensPerEdit",
]);

const KNOWN_TOP_KEYS = new Set(["thresholds", "weights", "dataDir", "defaultProject"]);

export function loadConfig(): InspectoConfig {
  const configPath = join(process.cwd(), ".inspecto.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write("inspecto: warning: .inspecto.json contains invalid JSON, using defaults\n");
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    process.stderr.write("inspecto: warning: .inspecto.json must be a JSON object, using defaults\n");
    return {};
  }

  const config = parsed as Record<string, unknown>;

  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      process.stderr.write(`inspecto: warning: .inspecto.json unknown key "${key}"\n`);
    }
  }

  if (config["thresholds"] && typeof config["thresholds"] === "object" && !Array.isArray(config["thresholds"])) {
    for (const key of Object.keys(config["thresholds"] as object)) {
      if (!KNOWN_THRESHOLD_KEYS.has(key)) {
        process.stderr.write(`inspecto: warning: .inspecto.json unknown thresholds key "${key}"\n`);
      }
    }
  }

  if (config["weights"] && typeof config["weights"] === "object" && !Array.isArray(config["weights"])) {
    for (const key of Object.keys(config["weights"] as object)) {
      if (!KNOWN_WEIGHT_KEYS.has(key)) {
        process.stderr.write(`inspecto: warning: .inspecto.json unknown weights key "${key}"\n`);
      }
    }

    const weights = config["weights"] as Record<string, unknown>;
    const numericValues = Object.values(weights).filter((v): v is number => typeof v === "number");
    const sum = numericValues.reduce((a, b) => a + b, 0);
    if (sum > 1.0 + 1e-9) {
      process.stderr.write(
        `inspecto: warning: weights in .inspecto.json sum to ${sum.toFixed(4)}, which exceeds 1.0\n`,
      );
    }
  }

  return parsed as InspectoConfig;
}
