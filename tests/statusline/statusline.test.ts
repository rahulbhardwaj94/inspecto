import { describe, expect, it } from "vitest";
import { loadFixture } from "../helpers.js";
import { renderStatusline, summarizeSession, type StatuslineSummary } from "../../src/statusline/summary.js";
import {
  installStatusLine,
  isInspectoStatusLine,
  quoteArg,
  uninstallStatusLine,
} from "../../src/statusline/settings.js";
import type { MergedTurn, Session } from "../../src/parser/types.js";

const base: StatuslineSummary = {
  assistantTurns: 10,
  letter: "B+",
  score: 84,
  costUsd: 1.5,
  cacheRate: 0.72,
  cacheStatus: "healthy",
  nudge: null,
};

describe("renderStatusline", () => {
  it("shows grade, cost and cache", () => {
    expect(renderStatusline(base, { color: false })).toBe("inspecto B+ 84 · $1.50 · cache 72%");
  });

  it("prefers Claude Code's live cost over the estimate", () => {
    expect(renderStatusline(base, { color: false, liveCostUsd: 2.345 })).toContain("$2.35");
  });

  it("hides the grade and cache until there are enough turns", () => {
    expect(renderStatusline({ ...base, assistantTurns: 1 }, { color: false })).toBe(
      "inspecto · warming up · $1.50",
    );
  });

  it("appends the nudge and emits ANSI colour by default", () => {
    const line = renderStatusline({ ...base, nudge: "↻ rephrasing a lot · try /clear" });
    expect(line).toContain("\u001b[");
    expect(line).toContain("try /clear");
  });
});

describe("summarizeSession", () => {
  it("summarises a real fixture", async () => {
    const s = summarizeSession(await loadFixture("healthy-session"));
    expect(s.assistantTurns).toBeGreaterThan(0);
    expect(s.letter).toMatch(/^[A-F][+-]?$/);
    expect(s.cacheRate).not.toBeNull();
  });

  it("nudges toward inspecto fix when a command fails repeatedly in this session", () => {
    const turns: MergedTurn[] = [];
    for (let i = 0; i < 3; i++) {
      const id = `t${i}`;
      turns.push({
        role: "assistant",
        content: [{ type: "tool_use", id, name: "Bash", input: { command: "npm test" } }],
        usage: null,
        complete: true,
        timestamp: `2026-10-01T00:00:0${i}.000Z`,
        isHumanTurn: false,
      });
      turns.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "Exit code 1", is_error: true }],
        usage: null,
        complete: true,
        timestamp: `2026-10-01T00:00:0${i}.500Z`,
        isHumanTurn: false,
      });
    }
    const session: Session = {
      id: "s",
      projectSlug: "p",
      model: "m",
      turns,
      startTime: "",
      endTime: "",
      cwd: "/repo",
      gitBranch: null,
      durationMs: 0,
      subagentCount: 0,
      subagentTurnCount: 0,
      formatVersion: "",
      unknownRecordTypes: new Set(),
    };
    expect(summarizeSession(session).nudge).toBe("`npm test` failed 3× · inspecto fix");
  });
});

describe("statusLine settings", () => {
  const cmd = "node /opt/inspecto/dist/index.js statusline";

  it("installs into empty or inspecto-owned settings, preserving other keys", () => {
    const fresh = installStatusLine({ model: "opus" }, cmd);
    expect(fresh).toEqual({
      ok: true,
      replaced: false,
      settings: { model: "opus", statusLine: { type: "command", command: cmd, padding: 0 } },
    });

    const again = installStatusLine((fresh as { settings: Record<string, unknown> }).settings, cmd);
    expect(again.ok && again.replaced).toBe(true);
  });

  it("refuses to clobber a custom statusLine unless forced", () => {
    const custom = { statusLine: { type: "command", command: "~/my-status.sh" } };
    expect(installStatusLine(custom, cmd)).toEqual({ ok: false, existing: custom.statusLine });
    expect(installStatusLine(custom, cmd, true).ok).toBe(true);
  });

  it("uninstalls only its own statusLine", () => {
    expect(uninstallStatusLine({ a: 1, statusLine: { type: "command", command: cmd } })).toEqual({ a: 1 });
    expect(uninstallStatusLine({ statusLine: { type: "command", command: "~/my-status.sh" } })).toBeNull();
    expect(isInspectoStatusLine({ command: "npx -y inspecto statusline" })).toBe(true);
  });

  it("quotes paths only when needed", () => {
    expect(quoteArg("/usr/lib/node_modules/inspecto/dist/index.js")).toBe(
      "/usr/lib/node_modules/inspecto/dist/index.js",
    );
    expect(quoteArg("/Users/My Name/inspecto.js")).toBe('"/Users/My Name/inspecto.js"');
    expect(quoteArg("C:\\Program Files\\inspecto.js")).toBe('"C:\\Program Files\\inspecto.js"');
  });
});
