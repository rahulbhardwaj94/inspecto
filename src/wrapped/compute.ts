/**
 * Claude Code Wrapped — a year of sessions boiled down to shareable stats.
 *
 * Two pure stages, like `fix`:
 *   digestSession(session, grade) — the few numbers Wrapped needs from one session
 *   computeWrapped(digests)       — aggregates them into the year's stats + a persona
 *
 * Digests are tiny, so the command can parse sessions concurrently and drop
 * each Session as soon as it is digested.
 */

import { basename } from "node:path";
import type { GradeResult, Session, ToolUseBlock } from "../parser/types.js";

export interface SessionDigest {
  id: string;
  projectSlug: string;
  model: string;
  startTime: string;
  durationMs: number;
  assistantTurns: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number | null;
  score: number;
  letter: string;
  readsPerEdit: number | null;
  subagentCount: number;
  linesWritten: number;
  toolCounts: Record<string, number>;
  /** Edits per file, keyed by absolute or session-relative path. */
  editCounts: Record<string, number>;
}

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export function digestSession(session: Session, grade: GradeResult): SessionDigest {
  const toolCounts: Record<string, number> = {};
  const editCounts: Record<string, number> = {};
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let linesWritten = 0;
  let assistantTurns = 0;

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;
    assistantTurns++;
    if (turn.usage && turn.complete) {
      outputTokens += turn.usage.output_tokens;
      cacheRead += turn.usage.cache_read_input_tokens;
      cacheCreation += turn.usage.cache_creation_input_tokens;
    }
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const tool = block as ToolUseBlock;
      const name = tool.name.startsWith("mcp__") ? "MCP tools" : tool.name;
      toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      if (!EDIT_TOOLS.has(tool.name)) continue;

      const path = (tool.input.file_path ?? tool.input.notebook_path) as unknown;
      if (typeof path === "string") editCounts[path] = (editCounts[path] ?? 0) + 1;
      linesWritten += countLines(tool.input.content) + countLines(tool.input.new_string) + countLines(tool.input.new_source);
      if (Array.isArray(tool.input.edits)) {
        for (const e of tool.input.edits) linesWritten += countLines((e as { new_string?: unknown })?.new_string);
      }
    }
  }

  const metric = (name: string) => grade.metrics.find((m) => m.name === name)?.value ?? null;

  return {
    id: session.id,
    projectSlug: session.projectSlug,
    model: session.model,
    startTime: session.startTime,
    durationMs: session.durationMs,
    assistantTurns,
    outputTokens,
    cacheRead,
    cacheCreation,
    costUsd: metric("session-cost"),
    score: grade.score,
    letter: grade.letter,
    readsPerEdit: metric("reads-per-edit"),
    subagentCount: session.subagentCount,
    linesWritten,
    toolCounts,
    editCounts,
  };
}

function countLines(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  return value.split("\n").length;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface Persona {
  name: string;
  emoji: string;
  blurb: string;
}

export interface Ranked {
  name: string;
  count: number;
}

export interface WrappedStats {
  year: number;
  sessions: number;
  activeDays: number;
  longestStreak: number;
  totalHours: number;
  totalCostUsd: number;
  outputTokens: number;
  linesWritten: number;
  filesEdited: number;
  cacheHitRate: number | null;
  avgScore: number;
  bestSession: { date: string; score: number; letter: string } | null;
  biggestDay: { date: string; sessions: number; costUsd: number } | null;
  busiestHour: number | null;
  busiestWeekday: string | null;
  /** sessions[weekday 0=Mon][hour 0-23] */
  heatmap: number[][];
  nightOwlShare: number;
  topModels: Ranked[];
  topProjects: Ranked[];
  topTools: Ranked[];
  topFiles: Ranked[];
  projectCount: number;
  persona: Persona;
}

export interface WrappedOptions {
  year: number;
  /** IANA zone for hours/days. Defaults to the system zone. */
  timeZone?: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function computeWrapped(digests: SessionDigest[], options: WrappedOptions): WrappedStats {
  const local = localizer(options.timeZone);
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const days = new Map<string, { sessions: number; costUsd: number }>();
  const models = new Map<string, number>();
  const projects = new Map<string, number>();
  const tools = new Map<string, number>();
  const files = new Map<string, number>();

  let totalMs = 0;
  let totalCost = 0;
  let outputTokens = 0;
  let linesWritten = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let scoreSum = 0;
  let night = 0;
  let best: WrappedStats["bestSession"] = null;

  for (const d of digests) {
    const when = local(d.startTime);
    if (when) {
      heatmap[when.weekday][when.hour]++;
      const day = days.get(when.date) ?? { sessions: 0, costUsd: 0 };
      day.sessions++;
      day.costUsd += d.costUsd ?? 0;
      days.set(when.date, day);
      if (when.hour >= 22 || when.hour < 5) night++;
    }

    totalMs += d.durationMs;
    totalCost += d.costUsd ?? 0;
    outputTokens += d.outputTokens;
    linesWritten += d.linesWritten;
    cacheRead += d.cacheRead;
    cacheCreation += d.cacheCreation;
    scoreSum += d.score;
    bump(models, shortModel(d.model));
    bump(projects, d.projectSlug);
    for (const [tool, n] of Object.entries(d.toolCounts)) bump(tools, tool, n);
    for (const [file, n] of Object.entries(d.editCounts)) bump(files, file, n);

    // Only sessions with real work compete for "best session".
    if (d.assistantTurns >= 5 && when && (!best || d.score > best.score)) {
      best = { date: when.date, score: d.score, letter: d.letter };
    }
  }

  const n = digests.length;
  const [busiestDate, busiestDay] = [...days.entries()].sort(
    (a, b) => b[1].sessions - a[1].sessions || b[1].costUsd - a[1].costUsd,
  )[0] ?? [null, null];

  const hourTotals = Array.from({ length: 24 }, (_, h) => heatmap.reduce((s, row) => s + row[h], 0));
  const dayTotals = heatmap.map((row) => row.reduce((s, v) => s + v, 0));

  const stats: Omit<WrappedStats, "persona"> = {
    year: options.year,
    sessions: n,
    activeDays: days.size,
    longestStreak: longestStreak([...days.keys()]),
    totalHours: totalMs / 3_600_000,
    totalCostUsd: totalCost,
    outputTokens,
    linesWritten,
    filesEdited: files.size,
    cacheHitRate: cacheRead + cacheCreation > 0 ? cacheRead / (cacheRead + cacheCreation) : null,
    avgScore: n > 0 ? scoreSum / n : 0,
    bestSession: best,
    biggestDay: busiestDate && busiestDay ? { date: busiestDate, ...busiestDay } : null,
    busiestHour: n > 0 && days.size > 0 ? argmax(hourTotals) : null,
    busiestWeekday: n > 0 && days.size > 0 ? WEEKDAYS[argmax(dayTotals)] : null,
    heatmap,
    nightOwlShare: n > 0 ? night / n : 0,
    topModels: rank(models, 3),
    topProjects: rank(projects, 3),
    topTools: rank(tools, 5),
    topFiles: rank(files, 3).map((f) => ({ ...f, name: basename(f.name) })),
    projectCount: projects.size,
  };

  return { ...stats, persona: pickPersona(stats, digests) };
}

/**
 * One archetype, first match wins. Ordered from most to least distinctive so
 * the label says something specific about how this person works.
 */
export function pickPersona(stats: Omit<WrappedStats, "persona">, digests: SessionDigest[]): Persona {
  const n = digests.length;
  const delegating = n > 0 ? digests.filter((d) => d.subagentCount > 0).length / n : 0;
  const rpe = digests.map((d) => d.readsPerEdit).filter((v): v is number => v !== null);
  const avgRpe = rpe.length > 0 ? rpe.reduce((a, b) => a + b, 0) / rpe.length : 0;
  const avgHours = n > 0 ? stats.totalHours / n : 0;

  if (n >= 10 && stats.nightOwlShare >= 0.4) {
    return { name: "The Night Owl", emoji: "🦉", blurb: "Your best ideas ship after dark." };
  }
  if (n >= 10 && delegating >= 0.3) {
    return { name: "The Conductor", emoji: "🎼", blurb: "Why do one thing when a team of subagents can do five?" };
  }
  if (rpe.length >= 5 && avgRpe >= 4) {
    return { name: "The Surgeon", emoji: "🔬", blurb: "Read twice, cut once. Your agent studies before it edits." };
  }
  if (n >= 5 && avgHours >= 1.5) {
    return { name: "The Marathoner", emoji: "🏃", blurb: "Long, deep sessions. You go the distance." };
  }
  if (n >= 20 && avgHours <= 0.25) {
    return { name: "The Sprinter", emoji: "⚡", blurb: "In, done, out. Short sessions, fast loops." };
  }
  if (stats.longestStreak >= 14) {
    return { name: "The Streaker", emoji: "🔥", blurb: `${stats.longestStreak} days in a row. Consistency is your superpower.` };
  }
  return { name: "The Builder", emoji: "🛠️", blurb: "Steady, curious, always shipping." };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LocalTime {
  date: string;
  hour: number;
  /** 0 = Monday */
  weekday: number;
}

function localizer(timeZone?: string): (iso: string) => LocalTime | null {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return (iso) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    const parts = Object.fromEntries(fmt.formatToParts(ms).map((p) => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour) % 24,
      weekday: weekdayIndex[parts.weekday] ?? 0,
    };
  };
}

/** Longest run of consecutive calendar days in a set of YYYY-MM-DD dates. */
export function longestStreak(dates: string[]): number {
  const dayNumbers = [...new Set(dates)].map((d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < dayNumbers.length; i++) {
    run = i > 0 && dayNumbers[i] - dayNumbers[i - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

function rank(map: Map<string, number>, n: number): Ranked[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "") || "unknown";
}
