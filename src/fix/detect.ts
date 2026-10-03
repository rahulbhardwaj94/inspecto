/**
 * Detects recurring, fixable failures in sessions and turns them into
 * CLAUDE.md rules.
 *
 * Detection is two-stage so the same events serve both `fix` and its
 * verification loop:
 *   detectEvents(session)  — every occurrence, no thresholds (pure, per session)
 *   buildFindings(events)  — groups occurrences by ruleId, applies thresholds
 */

import { createHash } from "node:crypto";
import type {
  ContentBlock,
  Session,
  ToolResultBlock,
  ToolUseBlock,
} from "../parser/types.js";
import type { FixEvent, FixFinding, FixKind } from "./types.js";

/** Commands whose non-zero exit is usually informational, not a mistake. */
const IGNORED_PROGRAMS = new Set([
  "grep", "rg", "egrep", "fgrep", "find", "ls", "cat", "head", "tail", "test", "[",
  "which", "type", "command", "diff", "cmp", "echo", "printf", "sleep", "kill",
  "pkill", "true", "false", "wc", "stat", "file", "pgrep",
]);

/** Results that mean the user stopped the tool, not that the command was wrong. */
const NON_FAILURE_PATTERNS = [
  /doesn't want to (?:proceed|take this action)/i,
  /interrupted by user/i,
  /\[Request interrupted/i,
  /permission to use .* (?:has been )?denied/i,
  /was blocked/i,
];

/** Program families: a correction must stay in the same toolchain. */
const FAMILIES: string[][] = [
  ["npm", "npx", "pnpm", "yarn", "bun", "bunx", "node", "tsx", "deno"],
  ["python", "python3", "pip", "pip3", "uv", "pytest", "poetry", "pipenv"],
  ["cargo", "rustc", "rustup"],
  ["go", "gofmt"],
  ["make", "cmake", "ninja"],
  ["bundle", "ruby", "rake", "rails", "rspec"],
  ["mvn", "gradle", "./gradlew", "./mvnw"],
  ["docker", "docker-compose", "podman"],
];

/** How many later Bash calls to search for the command that fixed a failure. */
const CORRECTION_LOOKAHEAD = 3;

interface BashCall {
  command: string;
  isError: boolean;
  errorText: string;
}

/** Every fixable failure occurrence in one session. */
export function detectEvents(session: Session): FixEvent[] {
  const events: FixEvent[] = [];
  const results = collectResults(session.turns.flatMap((t) => t.content));

  // Group calls per agent so a subagent's retry isn't paired with the parent's command.
  const bashByAgent = new Map<string, BashCall[]>();

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const tool = block as ToolUseBlock;
      const result = results.get(tool.id);
      if (!result) continue;
      const text = resultText(result);
      if (result.is_error === true && NON_FAILURE_PATTERNS.some((p) => p.test(text))) continue;

      if (tool.name === "Bash") {
        const raw = tool.input.command;
        if (typeof raw !== "string") continue;
        const command = normalizeCommand(raw);
        if (!command) continue;
        const key = turn.agentId ?? "main";
        const list = bashByAgent.get(key) ?? [];
        list.push({ command, isError: result.is_error === true, errorText: text });
        bashByAgent.set(key, list);
        continue;
      }

      if (result.is_error !== true) continue;
      const pathEvent = detectPathError(tool, text);
      if (pathEvent) events.push(pathEvent);
    }
  }

  for (const calls of bashByAgent.values()) {
    events.push(...detectBashEvents(calls));
  }

  return events;
}

function detectBashEvents(calls: BashCall[]): FixEvent[] {
  const events: FixEvent[] = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!call.isError || IGNORED_PROGRAMS.has(program(call.command))) continue;

    const errorLine = firstErrorLine(call.errorText);
    const fix = calls
      .slice(i + 1, i + 1 + CORRECTION_LOOKAHEAD)
      .find(
        (next) =>
          !next.isError &&
          next.command !== call.command &&
          !IGNORED_PROGRAMS.has(program(next.command)) &&
          sameFamily(call.command, next.command),
      );

    if (fix) {
      events.push({
        ruleId: makeRuleId("command-correction", `${call.command}\n${fix.command}`),
        kind: "command-correction",
        subject: call.command,
        replacement: fix.command,
        errorLine,
      });
    } else {
      events.push({
        ruleId: makeRuleId("failing-command", call.command),
        kind: "failing-command",
        subject: call.command,
        errorLine,
      });
    }
  }
  return events;
}

function detectPathError(tool: ToolUseBlock, text: string): FixEvent | null {
  const path =
    (tool.input.file_path as string | undefined) ??
    (tool.input.notebook_path as string | undefined) ??
    (tool.input.path as string | undefined) ??
    "";

  if (/has not been read yet|read it first/i.test(text)) {
    return { ruleId: makeRuleId("edit-before-read", ""), kind: "edit-before-read", subject: path };
  }
  if (/string to replace not found|old_string .*not found|not found in file/i.test(text)) {
    return { ruleId: makeRuleId("stale-edit", ""), kind: "stale-edit", subject: path };
  }
  if (path && /does not exist|no such file|ENOENT/i.test(text)) {
    return { ruleId: makeRuleId("missing-path", ""), kind: "missing-path", subject: path };
  }
  return null;
}

export interface FindingOptions {
  /** Minimum occurrences before a lesson becomes a rule. Default 2. */
  minOccurrences?: number;
  /** Maximum findings returned, most frequent first. Default 10. */
  limit?: number;
}

/**
 * Group per-session events into findings. `perSession` holds one event list
 * per session so findings can report how many distinct sessions hit each lesson.
 */
export function buildFindings(perSession: FixEvent[][], options: FindingOptions = {}): FixFinding[] {
  const minOccurrences = options.minOccurrences ?? 2;
  const limit = options.limit ?? 10;

  const groups = new Map<string, { events: FixEvent[]; sessions: number }>();
  for (const events of perSession) {
    const seen = new Set<string>();
    for (const event of events) {
      const group = groups.get(event.ruleId) ?? { events: [], sessions: 0 };
      group.events.push(event);
      if (!seen.has(event.ruleId)) {
        group.sessions++;
        seen.add(event.ruleId);
      }
      groups.set(event.ruleId, group);
    }
  }

  // A command that was eventually corrected gets a correction rule; don't also
  // emit a vaguer "keeps failing" rule for the same command.
  const corrected = new Set<string>();
  for (const { events } of groups.values()) {
    if (events[0].kind === "command-correction") corrected.add(events[0].subject);
  }

  const findings: FixFinding[] = [];
  for (const [ruleId, { events, sessions }] of groups) {
    const first = events[0];
    if (first.kind === "failing-command" && corrected.has(first.subject)) continue;
    if (events.length < minOccurrences) continue;
    findings.push({
      ruleId,
      kind: first.kind,
      ...describe(first.kind, events),
      occurrences: events.length,
      sessions,
    });
  }

  findings.sort((a, b) => b.occurrences - a.occurrences || a.ruleId.localeCompare(b.ruleId));
  return findings.slice(0, limit);
}

function describe(kind: FixKind, events: FixEvent[]): { rule: string; evidence: string } {
  const first = events[0];
  const n = events.length;
  const err = first.errorLine ? ` Last error: "${first.errorLine}".` : "";

  switch (kind) {
    case "command-correction":
      return {
        rule: `Run \`${first.replacement}\` instead of \`${first.subject}\` — the latter fails in this repo.`,
        evidence: `\`${first.subject}\` failed ${n}× and was followed by \`${first.replacement}\`, which worked.${err}`,
      };
    case "failing-command":
      return {
        rule: `\`${first.subject}\` fails in this repo${first.errorLine ? ` ("${first.errorLine}")` : ""}. Check the documented commands before running it, and don't retry it unchanged.`,
        evidence: `\`${first.subject}\` failed ${n}× with no working alternative found.${err}`,
      };
    case "edit-before-read":
      return {
        rule: "Always Read a file before editing or overwriting it.",
        evidence: `${n} edits were rejected because the file had not been read first.`,
      };
    case "stale-edit":
      return {
        rule: "Re-read a file right before editing it if it may have changed; copy `old_string` exactly from the latest Read output.",
        evidence: `${n} edits failed because \`old_string\` didn't match the file.`,
      };
    case "missing-path": {
      const paths = topSubjects(events, 5).map((p) => `\`${p}\``).join(", ");
      return {
        rule: `Don't guess file paths — locate files with Glob or Grep first. Paths previously guessed that don't exist: ${paths}.`,
        evidence: `${n} tool calls targeted paths that don't exist.`,
      };
    }
  }
}

function topSubjects(events: FixEvent[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.subject) counts.set(e.subject, (counts.get(e.subject) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([s]) => s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeRuleId(kind: FixKind, key: string): string {
  if (!key) return kind;
  return `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 8)}`;
}

function collectResults(blocks: ContentBlock[]): Map<string, ToolResultBlock> {
  const map = new Map<string, ToolResultBlock>();
  for (const block of blocks) {
    if (block.type === "tool_result") map.set(block.tool_use_id, block);
  }
  return map;
}

function resultText(result: ToolResultBlock): string {
  if (typeof result.content === "string") return result.content;
  if (!Array.isArray(result.content)) return "";
  return result.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
}

/**
 * Reduce a command to the part that identifies it: drop `cd <dir> &&`
 * prefixes, output plumbing (`2>&1`, `| head`, `| tail`) and extra whitespace.
 * Returns "" for commands too ad-hoc to learn from (multi-line scripts).
 */
export function normalizeCommand(raw: string): string {
  if (raw.includes("\n")) return "";
  let cmd = raw.trim();
  cmd = cmd.replace(/^(?:cd\s+\S+\s*&&\s*)+/, "");
  cmd = cmd.replace(/\s*\|\s*(?:head|tail)(?:\s+-n?\s*\d+|\s+-\d+)?\s*$/, "");
  cmd = cmd.replace(/\s+2>&1\s*$/, "");
  cmd = cmd.replace(/\s+/g, " ").trim();
  if (cmd.length > 160) return "";
  return cmd;
}

function program(command: string): string {
  // Skip leading env assignments like `CI=1 npm test`.
  const tokens = command.split(" ").filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  return tokens[0] ?? "";
}

function sameFamily(a: string, b: string): boolean {
  const pa = program(a);
  const pb = program(b);
  if (pa === pb) return true;
  return FAMILIES.some((family) => family.includes(pa) && family.includes(pb));
}

function firstErrorLine(text: string): string | undefined {
  const line = text
    .replace(/<\/?tool_use_error>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^exit code \d+$/i.test(l));
  if (!line) return undefined;
  return line.length > 100 ? `${line.slice(0, 97)}...` : line;
}
