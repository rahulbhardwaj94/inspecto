import { describe, expect, it } from "vitest";
import { buildFindings, detectEvents, makeRuleId, normalizeCommand } from "../../src/fix/detect.js";
import { BLOCK_END, mergeRules, parseAppliedRules } from "../../src/fix/claude-md.js";
import { verifyRules } from "../../src/fix/verify.js";
import { sessionInRepo } from "../../src/commands/fix.js";
import type { MergedTurn, Session } from "../../src/parser/types.js";
import type { FixEvent } from "../../src/fix/types.js";

interface Call {
  name: string;
  input: Record<string, unknown>;
  result: string;
  error?: boolean;
  agentId?: string;
}

let seq = 0;

function makeSession(calls: Call[], opts: { cwd?: string; startTime?: string } = {}): Session {
  const turns: MergedTurn[] = [];
  for (const c of calls) {
    const id = `tu_${seq++}`;
    turns.push({
      role: "assistant",
      content: [{ type: "tool_use", id, name: c.name, input: c.input }],
      usage: null,
      complete: true,
      timestamp: "2026-10-01T00:00:00.000Z",
      isHumanTurn: false,
      agentId: c.agentId,
    });
    turns.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: c.result, is_error: c.error }],
      usage: null,
      complete: true,
      timestamp: "2026-10-01T00:00:00.000Z",
      isHumanTurn: false,
      agentId: c.agentId,
    });
  }
  return {
    id: `s${seq}`,
    projectSlug: "p",
    model: "m",
    turns,
    startTime: opts.startTime ?? "2026-10-01T00:00:00.000Z",
    endTime: opts.startTime ?? "2026-10-01T00:00:00.000Z",
    cwd: opts.cwd ?? "/repo",
    gitBranch: null,
    durationMs: 0,
    subagentCount: 0,
    subagentTurnCount: 0,
    formatVersion: "",
    unknownRecordTypes: new Set(),
  };
}

const bash = (command: string, result: string, error = false, agentId?: string): Call => ({
  name: "Bash",
  input: { command },
  result,
  error,
  agentId,
});

describe("normalizeCommand", () => {
  it("strips cd prefixes, output plumbing and extra whitespace", () => {
    expect(normalizeCommand("cd /repo && npm   test 2>&1 | tail -20")).toBe("npm test");
    expect(normalizeCommand("cd a && cd b && pytest -x | head -n 50")).toBe("pytest -x");
  });

  it("rejects multi-line scripts", () => {
    expect(normalizeCommand("cat <<EOF\nhi\nEOF")).toBe("");
  });
});

describe("detectEvents", () => {
  it("pairs a failed command with the same-toolchain command that worked", () => {
    const s = makeSession([
      bash("npm test", "Exit code 1\nError: no test specified", true),
      bash("npx vitest run", "12 passed"),
    ]);
    const events = detectEvents(s);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "command-correction",
      subject: "npm test",
      replacement: "npx vitest run",
      errorLine: "Error: no test specified",
    });
  });

  it("does not pair across toolchains or agents", () => {
    const s = makeSession([
      bash("npm test", "boom", true),
      bash("git log", "ok"),
      bash("pytest", "boom", true, "agent-1"),
      bash("npx vitest run", "ok", false, "agent-2"),
    ]);
    const kinds = detectEvents(s).map((e) => e.kind);
    expect(kinds).toEqual(["failing-command", "failing-command"]);
  });

  it("ignores informational exits and user interruptions", () => {
    const s = makeSession([
      bash("grep -r foo src", "Exit code 1", true),
      bash("npm run build", "The user doesn't want to proceed with this tool use.", true),
    ]);
    expect(detectEvents(s)).toEqual([]);
  });

  it("detects file-tool mistakes", () => {
    const s = makeSession([
      { name: "Edit", input: { file_path: "/repo/a.ts" }, result: "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>", error: true },
      { name: "Edit", input: { file_path: "/repo/a.ts" }, result: "<tool_use_error>String to replace not found in file.</tool_use_error>", error: true },
      { name: "Read", input: { file_path: "/repo/nope.ts" }, result: "File does not exist.", error: true },
    ]);
    expect(detectEvents(s).map((e) => e.kind)).toEqual(["edit-before-read", "stale-edit", "missing-path"]);
  });
});

describe("buildFindings", () => {
  const correction = makeSession([bash("npm test", "x", true), bash("npx vitest run", "ok")]);

  it("applies the occurrence threshold and counts sessions", () => {
    const one = buildFindings([detectEvents(correction)]);
    expect(one).toEqual([]);

    const two = buildFindings([detectEvents(correction), detectEvents(correction)]);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ kind: "command-correction", occurrences: 2, sessions: 2 });
    expect(two[0].rule).toContain("Run `npx vitest run` instead of `npm test`");
  });

  it("suppresses the vague failing-command rule once a correction exists", () => {
    const failing = makeSession([bash("npm test", "x", true), bash("npm test", "x", true)]);
    const findings = buildFindings(
      [detectEvents(failing), detectEvents(correction), detectEvents(correction)],
    );
    expect(findings.map((f) => f.kind)).toEqual(["command-correction"]);
  });

  it("lists the most-guessed missing paths in the rule", () => {
    const s = makeSession([
      { name: "Read", input: { file_path: "/repo/x.ts" }, result: "File does not exist.", error: true },
      { name: "Read", input: { file_path: "/repo/x.ts" }, result: "File does not exist.", error: true },
    ]);
    const [finding] = buildFindings([detectEvents(s)]);
    expect(finding.rule).toContain("`/repo/x.ts`");
  });
});

describe("CLAUDE.md merge", () => {
  const finding = {
    ruleId: makeRuleId("command-correction", "npm test\nnpx vitest run"),
    kind: "command-correction" as const,
    rule: "Run `npx vitest run` instead of `npm test`.",
    evidence: "",
    occurrences: 2,
    sessions: 2,
  };

  it("creates a managed block, then appends idempotently", () => {
    const first = mergeRules("# Project\n\nSome docs.\n", [finding], "2026-10-01T00:00:00.000Z");
    expect(first.added).toHaveLength(1);
    expect(first.content.startsWith("# Project\n\nSome docs.\n\n<!-- inspecto:fix:start")).toBe(true);
    expect(first.content.trimEnd().endsWith(BLOCK_END)).toBe(true);

    const again = mergeRules(first.content, [finding], "2026-10-02T00:00:00.000Z");
    expect(again.added).toEqual([]);
    expect(again.content).toBe(first.content);

    const other = { ...finding, ruleId: "edit-before-read", rule: "Always Read first." };
    const second = mergeRules(first.content, [other], "2026-10-02T00:00:00.000Z");
    const rules = parseAppliedRules(second.content);
    expect(rules.map((r) => r.ruleId)).toEqual([finding.ruleId, "edit-before-read"]);
    expect(rules[1]).toMatchObject({ appliedAt: "2026-10-02T00:00:00.000Z", text: "Always Read first." });
    expect(second.content.indexOf("Always Read first.")).toBeLessThan(second.content.indexOf(BLOCK_END));
  });

  it("keeps user-edited rule text", () => {
    const { content } = mergeRules("", [finding], "2026-10-01T00:00:00.000Z");
    const edited = content.replace("Run `npx vitest run` instead of `npm test`.", "Use vitest.");
    expect(parseAppliedRules(edited)[0].text).toBe("Use vitest.");
  });
});

describe("verifyRules", () => {
  const rule = { ruleId: "edit-before-read", appliedAt: "2026-10-05T00:00:00.000Z", text: "" };
  const ev: FixEvent = { ruleId: "edit-before-read", kind: "edit-before-read", subject: "" };
  const at = (day: number, count: number) => ({
    startTime: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    events: Array.from({ length: count }, () => ev),
  });

  it("waits for enough sessions after the rule", () => {
    const [v] = verifyRules([rule], [at(1, 2), at(6, 0)]);
    expect(v.verdict).toBe("collecting data");
    expect(v.sessionsAfter).toBe(1);
  });

  it("reports working, no change, worse and no baseline", () => {
    expect(verifyRules([rule], [at(1, 2), at(2, 2), at(6, 0), at(7, 1), at(8, 0)])[0]).toMatchObject({
      verdict: "working",
      rateBefore: 2,
    });
    expect(verifyRules([rule], [at(1, 1), at(6, 1), at(7, 1), at(8, 1)])[0].verdict).toBe("no change");
    expect(verifyRules([rule], [at(1, 1), at(6, 2), at(7, 2), at(8, 2)])[0].verdict).toBe("worse");
    expect(verifyRules([rule], [at(6, 0), at(7, 0), at(8, 0)])[0].verdict).toBe("no baseline");
  });
});

describe("sessionInRepo", () => {
  it("matches by cwd or by edited files", () => {
    expect(sessionInRepo(makeSession([], { cwd: "/repo/sub" }), "/repo")).toBe(true);
    expect(sessionInRepo(makeSession([], { cwd: "/elsewhere" }), "/repo")).toBe(false);
    const editor = makeSession(
      [{ name: "Edit", input: { file_path: "/repo/a.ts" }, result: "ok" }],
      { cwd: "/elsewhere" },
    );
    expect(sessionInRepo(editor, "/repo")).toBe(true);
    expect(sessionInRepo(makeSession([], { cwd: "/repository" }), "/repo")).toBe(false);
  });
});
