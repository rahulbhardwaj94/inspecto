/**
 * Pulse command — "is Claude off today?"
 *
 * Compares each model's recent sessions against your own baseline and flags
 * symptoms that rose clearly and significantly. Entirely local by default.
 *
 * Community sharing is opt-in twice over: nothing is sent without `--share`,
 * and there is no built-in endpoint — the collector URL must be configured
 * (`--endpoint` or INSPECTO_PULSE_URL). `--share-preview` prints the exact
 * payload without sending it.
 */

import chalk from "chalk";
import { scanSessions } from "../parser/project-scanner.js";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { concurrentSettled } from "../utils/concurrent.js";
import { loadConfig } from "../config/loader.js";
import { formatPercent } from "../utils/format.js";
import { VERSION } from "../version.js";
import {
  buildSharePayload,
  comparePulse,
  sessionSignals,
  type ModelPulse,
  type SessionSignals,
  type SymptomComparison,
} from "../pulse/signals.js";
import type { SessionFile } from "../parser/types.js";

const CONCURRENCY = 16;
const HOUR_MS = 3_600_000;

export interface PulseOptions {
  hours?: string;
  baseline?: string;
  json?: boolean;
  share?: boolean;
  sharePreview?: boolean;
  endpoint?: string;
  dataDir?: string;
  project?: string;
  fail?: boolean;
}

export async function runPulse(options: PulseOptions): Promise<void> {
  const config = loadConfig();
  const hours = positiveInt(options.hours ?? "24", "--hours");
  const baselineDays = positiveInt(options.baseline ?? "14", "--baseline");

  const now = Date.now();
  const recentStart = now - hours * HOUR_MS;
  const baselineStart = recentStart - baselineDays * 24 * HOUR_MS;

  const files = await scanSessions({
    dataDir: options.dataDir ?? config.dataDir,
    project: options.project ?? config.defaultProject,
    since: new Date(baselineStart),
  });
  const settled = await concurrentSettled(files, CONCURRENCY, async (sf: SessionFile) =>
    sessionSignals(await buildSession(readJsonl(sf.path), sf.sessionId, sf.projectSlug, sf.subagentPaths)),
  );
  const signals = settled
    .filter((r): r is PromiseFulfilledResult<SessionSignals> => r.status === "fulfilled")
    .map((r) => r.value);

  if (options.share || options.sharePreview) {
    const payload = buildSharePayload(signals, recentStart, `inspecto/${VERSION}`);
    if (options.sharePreview || !options.share) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    await share(payload, options.endpoint ?? process.env.INSPECTO_PULSE_URL);
    return;
  }

  const pulses = comparePulse(signals, recentStart, baselineStart);
  if (options.json) {
    console.log(JSON.stringify({ hours, baselineDays, models: pulses }, null, 2));
  } else {
    console.log(renderPulse(pulses, hours, baselineDays));
  }
  if (options.fail !== false && pulses.some((p) => p.verdict === "worse than usual")) {
    process.exitCode = 1;
  }
}

async function share(payload: ReturnType<typeof buildSharePayload>, endpoint: string | undefined): Promise<void> {
  if (!endpoint) {
    throw new Error(
      "No pulse endpoint configured, so nothing was sent. Pass --endpoint <url> or set INSPECTO_PULSE_URL. " +
        "Run with --share-preview to see exactly what would be sent.",
    );
  }
  if (!/^https:\/\//.test(endpoint)) throw new Error("The pulse endpoint must be an https:// URL.");
  if (payload.buckets.length === 0) {
    console.log("No sessions in the window, so there is nothing to share.");
    return;
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Pulse endpoint returned HTTP ${res.status}; nothing was recorded.`);
  const models = new Set(payload.buckets.map((b) => b.model)).size;
  console.log(
    `${chalk.green("✓")} Shared ${payload.buckets.length} hourly bucket(s) across ${models} model(s) to ${endpoint}`,
  );
}

function renderPulse(pulses: ModelPulse[], hours: number, baselineDays: number): string {
  const lines: string[] = [""];
  lines.push(chalk.bold(`  inspecto v${VERSION}`) + chalk.dim(" — Pulse: is Claude off today?"));
  lines.push(chalk.dim(`  Your sessions in the last ${hours}h vs your previous ${baselineDays} days, per model`));
  lines.push("");

  if (pulses.length === 0) {
    lines.push(chalk.dim(`  No sessions in the last ${hours}h.`));
    lines.push("");
    return lines.join("\n");
  }

  for (const p of pulses) {
    const badge =
      p.verdict === "worse than usual"
        ? chalk.red("⚠ worse than usual")
        : p.verdict === "normal"
          ? chalk.green("✓ normal")
          : chalk.dim("… not enough data");
    lines.push(`  ${chalk.bold(p.model.padEnd(16))} ${badge}`);
    lines.push(
      chalk.dim(`    ${p.recent.sessions} recent session${p.recent.sessions === 1 ? "" : "s"} · ${p.baseline.sessions} baseline`),
    );
    for (const s of p.symptoms) lines.push(`    ${symptomLine(s)}`);
  }

  lines.push("");
  lines.push(
    chalk.dim(
      "  This compares you with yourself: a harder task, a new repo or a new workflow can look the same as a model regression.",
    ),
  );
  lines.push("");
  return lines.join("\n");
}

function symptomLine(s: SymptomComparison): string {
  const fmt = (r: number | null) => (r === null ? "—" : formatPercent(r));
  const z = s.z === null ? chalk.dim("too few samples") : chalk.dim(`z=${s.z.toFixed(1)}`);
  const text = `${s.name.padEnd(19)} ${fmt(s.recentRate).padStart(4)} now vs ${fmt(s.baselineRate).padStart(4)} usual  ${z}`;
  return s.worse ? chalk.red(`▲ ${text}`) : `  ${text}`;
}

function positiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer.`);
  return n;
}
