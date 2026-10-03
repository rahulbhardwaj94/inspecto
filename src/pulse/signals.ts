/**
 * Pulse — "is Claude off today?"
 *
 * Each session is reduced to a few symptom counts that a degraded model tends
 * to move: tool errors, rephrased requests, and failed edits. `comparePulse`
 * pools those counts per model for a recent window and for a baseline, then
 * flags a model only when a symptom is both clearly higher (relative lift)
 * and statistically distinguishable (two-proportion z-test).
 *
 * The same counts, bucketed by UTC hour with no identifiers, form the
 * optional community payload (`buildSharePayload`).
 */

import type { Session, TextBlock, ToolResultBlock, ToolUseBlock } from "../parser/types.js";
import { detectEvents, isNonFailure, resultText } from "../fix/detect.js";
import { normalizedSimilarity } from "../utils/levenshtein.js";
import { shortModel } from "../wrapped/compute.js";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Same threshold as the retry-density metric. */
const RETRY_SIMILARITY = 0.6;

export interface PulseCounts {
  sessions: number;
  toolCalls: number;
  toolErrors: number;
  /** Consecutive pairs of human messages. */
  messagePairs: number;
  /** Pairs where the second message rephrases the first. */
  retries: number;
  editCalls: number;
  /** Edits rejected as edit-before-read or stale old_string. */
  editFailures: number;
}

export interface SessionSignals extends PulseCounts {
  model: string;
  startTime: string;
}

export function emptyCounts(): PulseCounts {
  return { sessions: 0, toolCalls: 0, toolErrors: 0, messagePairs: 0, retries: 0, editCalls: 0, editFailures: 0 };
}

export function sessionSignals(session: Session): SessionSignals {
  const counts = emptyCounts();
  counts.sessions = 1;

  const humanTexts: string[] = [];
  for (const turn of session.turns) {
    if (turn.isHumanTurn) {
      const text = turn.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ");
      if (text) humanTexts.push(text);
    }
    for (const block of turn.content) {
      if (block.type === "tool_use" && EDIT_TOOLS.has((block as ToolUseBlock).name)) counts.editCalls++;
      if (block.type !== "tool_result") continue;
      const result = block as ToolResultBlock;
      // A user stopping or denying a tool says nothing about the model.
      if (result.is_error === true && isNonFailure(resultText(result))) continue;
      counts.toolCalls++;
      if (result.is_error === true) counts.toolErrors++;
    }
  }

  for (let i = 1; i < humanTexts.length; i++) {
    counts.messagePairs++;
    if (normalizedSimilarity(humanTexts[i - 1], humanTexts[i]) > RETRY_SIMILARITY) counts.retries++;
  }

  counts.editFailures = detectEvents(session).filter(
    (e) => e.kind === "edit-before-read" || e.kind === "stale-edit",
  ).length;

  return { ...counts, model: shortModel(session.model), startTime: session.startTime };
}

export function addCounts(into: PulseCounts, from: PulseCounts): void {
  into.sessions += from.sessions;
  into.toolCalls += from.toolCalls;
  into.toolErrors += from.toolErrors;
  into.messagePairs += from.messagePairs;
  into.retries += from.retries;
  into.editCalls += from.editCalls;
  into.editFailures += from.editFailures;
}

// ---------------------------------------------------------------------------
// Recent vs baseline
// ---------------------------------------------------------------------------

export type SymptomName = "tool errors" | "rephrased requests" | "failed edits";

export interface SymptomComparison {
  name: SymptomName;
  recentRate: number | null;
  baselineRate: number | null;
  /** Two-proportion z statistic; positive means worse recently. */
  z: number | null;
  worse: boolean;
}

export type PulseVerdict = "worse than usual" | "normal" | "not enough data";

export interface ModelPulse {
  model: string;
  recent: PulseCounts;
  baseline: PulseCounts;
  symptoms: SymptomComparison[];
  verdict: PulseVerdict;
}

/** Minimum evidence before judging a model. */
export const MIN_RECENT_SESSIONS = 2;
export const MIN_BASELINE_SESSIONS = 5;
/** A symptom must rise by this factor AND clear Z_THRESHOLD to count. */
export const MIN_LIFT = 1.5;
export const Z_THRESHOLD = 2;
/** Per-symptom minimum trials in each window for a z-test to mean anything. */
const MIN_TRIALS = 20;

export function comparePulse(signals: SessionSignals[], recentStartMs: number, baselineStartMs: number): ModelPulse[] {
  const byModel = new Map<string, { recent: PulseCounts; baseline: PulseCounts }>();

  for (const s of signals) {
    const start = Date.parse(s.startTime);
    if (Number.isNaN(start) || start < baselineStartMs) continue;
    const entry = byModel.get(s.model) ?? { recent: emptyCounts(), baseline: emptyCounts() };
    addCounts(start >= recentStartMs ? entry.recent : entry.baseline, s);
    byModel.set(s.model, entry);
  }

  const result: ModelPulse[] = [];
  for (const [model, { recent, baseline }] of byModel) {
    if (recent.sessions === 0) continue; // only report models used in the recent window
    const symptoms: SymptomComparison[] = [
      compare("tool errors", recent.toolErrors, recent.toolCalls, baseline.toolErrors, baseline.toolCalls),
      compare("rephrased requests", recent.retries, recent.messagePairs, baseline.retries, baseline.messagePairs),
      compare("failed edits", recent.editFailures, recent.editCalls, baseline.editFailures, baseline.editCalls),
    ];
    const enough = recent.sessions >= MIN_RECENT_SESSIONS && baseline.sessions >= MIN_BASELINE_SESSIONS;
    result.push({
      model,
      recent,
      baseline,
      symptoms,
      verdict: !enough ? "not enough data" : symptoms.some((s) => s.worse) ? "worse than usual" : "normal",
    });
  }

  return result.sort((a, b) => b.recent.sessions - a.recent.sessions || a.model.localeCompare(b.model));
}

function compare(
  name: SymptomName,
  recentHits: number,
  recentTrials: number,
  baseHits: number,
  baseTrials: number,
): SymptomComparison {
  const recentRate = recentTrials > 0 ? recentHits / recentTrials : null;
  const baselineRate = baseTrials > 0 ? baseHits / baseTrials : null;
  const z = recentTrials >= MIN_TRIALS && baseTrials >= MIN_TRIALS
    ? twoProportionZ(recentHits, recentTrials, baseHits, baseTrials)
    : null;
  const lifted =
    recentRate !== null && baselineRate !== null && recentRate > 0 &&
    (baselineRate === 0 ? recentRate >= 0.05 : recentRate / baselineRate >= MIN_LIFT);
  return { name, recentRate, baselineRate, z, worse: lifted && z !== null && z >= Z_THRESHOLD };
}

/** z for H0: p1 = p2, using the pooled proportion. Positive when p1 > p2. */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

// ---------------------------------------------------------------------------
// Community payload
// ---------------------------------------------------------------------------

export const SHARE_SCHEMA_VERSION = 1;

export interface ShareBucket extends PulseCounts {
  model: string;
  /** UTC hour the sessions started in, e.g. "2026-10-03T04". */
  hour: string;
}

export interface SharePayload {
  schema: number;
  client: string;
  buckets: ShareBucket[];
}

/**
 * Counts only, per model per UTC hour: no session ids, paths, projects,
 * prompts, tool inputs, timestamps finer than an hour, or user identifiers.
 */
export function buildSharePayload(signals: SessionSignals[], sinceMs: number, client: string): SharePayload {
  const buckets = new Map<string, ShareBucket>();
  for (const s of signals) {
    const start = Date.parse(s.startTime);
    if (Number.isNaN(start) || start < sinceMs) continue;
    const hour = new Date(start).toISOString().slice(0, 13);
    const key = `${s.model}|${hour}`;
    const bucket = buckets.get(key) ?? { model: s.model, hour, ...emptyCounts() };
    addCounts(bucket, s);
    buckets.set(key, bucket);
  }
  return {
    schema: SHARE_SCHEMA_VERSION,
    client,
    buckets: [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour) || a.model.localeCompare(b.model)),
  };
}
