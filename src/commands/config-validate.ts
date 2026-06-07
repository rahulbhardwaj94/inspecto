import chalk from "chalk";
import Table from "cli-table3";
import { loadConfig } from "../config/loader.js";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "../config/types.js";

export async function runConfigValidate(): Promise<void> {
  const config = loadConfig();
  const hasConfig = Object.keys(config).length > 0;

  console.log("");
  if (!hasConfig) {
    console.log(chalk.dim("  No .inspecto.json found in current directory. Showing all defaults.\n"));
  } else {
    console.log(chalk.bold("  .inspecto.json") + chalk.dim(" — effective configuration\n"));
  }

  // Thresholds table
  const thresholdTable = new Table({
    head: ["Metric", "healthy", "warning", "Source"].map((h) => chalk.dim(h)),
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  const thresholdEntries: Array<[keyof typeof DEFAULT_THRESHOLDS, string]> = [
    ["readsPerEdit", "reads-per-edit"],
    ["rewriteRatio", "rewrite-ratio"],
    ["cacheHitRate", "cache-hit-rate"],
    ["taskCompletion", "task-completion"],
    ["retryDensity", "retry-density"],
    ["toolDiversity", "tool-diversity"],
    ["tokensPerEdit", "tokens-per-edit"],
    ["sessionCost", "session-cost"],
  ];

  for (const [key, label] of thresholdEntries) {
    const override = config.thresholds?.[key];
    const def = DEFAULT_THRESHOLDS[key];
    const effective = { ...def, ...override };
    const source = override ? chalk.green("config") : chalk.dim("default");
    thresholdTable.push([label, String(effective.healthy), String(effective.warning), source]);
  }

  console.log(chalk.bold("  Thresholds"));
  console.log(thresholdTable.toString());
  console.log("");

  // Weights table
  const weightTable = new Table({
    head: ["Metric", "Weight", "Source"].map((h) => chalk.dim(h)),
    style: { head: [], border: [], "padding-left": 2, "padding-right": 2 },
    chars: {
      top: "─", "top-mid": "─", "top-left": "  ", "top-right": "",
      bottom: "─", "bottom-mid": "─", "bottom-left": "  ", "bottom-right": "",
      left: "  ", "left-mid": "  ", mid: "─", "mid-mid": "─",
      right: "", "right-mid": "", middle: "  ",
    },
  });

  const weightEntries: Array<[keyof typeof DEFAULT_WEIGHTS, string]> = [
    ["readsPerEdit", "reads-per-edit"],
    ["rewriteRatio", "rewrite-ratio"],
    ["cacheHitRate", "cache-hit-rate"],
    ["taskCompletion", "task-completion"],
    ["retryDensity", "retry-density"],
    ["toolDiversity", "tool-diversity"],
    ["tokensPerEdit", "tokens-per-edit"],
  ];

  let configuredWeightSum = 0;
  for (const [key] of weightEntries) {
    configuredWeightSum += config.weights?.[key] ?? DEFAULT_WEIGHTS[key];
  }

  for (const [key, label] of weightEntries) {
    const override = config.weights?.[key];
    const effective = override ?? DEFAULT_WEIGHTS[key];
    const source = override !== undefined ? chalk.green("config") : chalk.dim("default");
    weightTable.push([label, effective.toFixed(2), source]);
  }

  console.log(chalk.bold("  Weights") + chalk.dim(` (configurable sum: ${configuredWeightSum.toFixed(2)})`));
  console.log(weightTable.toString());
  console.log("");

  // Other settings
  if (config.dataDir || config.defaultProject) {
    console.log(chalk.bold("  Other settings"));
    if (config.dataDir) {
      console.log(`  ${chalk.dim("dataDir")}        ${config.dataDir}  ${chalk.green("(config)")}`);
    }
    if (config.defaultProject) {
      console.log(`  ${chalk.dim("defaultProject")} ${config.defaultProject}  ${chalk.green("(config)")}`);
    }
    console.log("");
  }
}
