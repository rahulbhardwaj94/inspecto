import { describe, expect, it } from "vitest";
import {
  buildSharePayload,
  comparePulse,
  emptyCounts,
  sessionSignals,
  twoProportionZ,
  type SessionSignals,
} from "../../src/pulse/signals.js";
import type { MergedTurn, Session } from "../../src/parser/types.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const RECENT = NOW - DAY;
const BASELINE = RECENT - 14 * DAY;

function sig(over: Partial<SessionSignals>): SessionSignals {
  return { ...emptyCounts(), sessions: 1, model: "opus-5-5", startTime: new Date(NOW - 3 * DAY).toISOString(), ...over };
}

/** n sessions, each with `calls` tool calls of which `errors` failed. */
function many(n: number, at: number, calls: number, errors: number, model = "opus-5-5"): SessionSignals[] {
  return Array.from({ length: n }, (_, i) =>
    sig({ model, startTime: new Date(at - i * 60_000).toISOString(), toolCalls: calls, toolErrors: errors }),
  );
}

describe("twoProportionZ", () => {
  it("is positive when the first rate is higher and ~0 when equal", () => {
    expect(twoProportionZ(30, 100, 10, 100)).toBeGreaterThan(3);
    expect(twoProportionZ(10, 100, 10, 100)).toBe(0);
    expect(twoProportionZ(0, 10, 0, 10)).toBe(0);
  });
});

describe("comparePulse", () => {
  it("flags a model whose tool error rate jumped significantly", () => {
    const signals = [...many(10, NOW - 5 * DAY, 20, 1), ...many(3, NOW - 3600_000, 20, 5)];
    const [p] = comparePulse(signals, RECENT, BASELINE);
    expect(p.verdict).toBe("worse than usual");
    const errors = p.symptoms.find((s) => s.name === "tool errors")!;
    expect(errors.worse).toBe(true);
    expect(errors.recentRate).toBeCloseTo(0.25);
    expect(errors.baselineRate).toBeCloseTo(0.05);
  });

  it("calls a steady model normal", () => {
    const signals = [...many(10, NOW - 5 * DAY, 20, 1), ...many(3, NOW - 3600_000, 20, 1)];
    expect(comparePulse(signals, RECENT, BASELINE)[0].verdict).toBe("normal");
  });

  it("needs a large enough lift, not just significance", () => {
    // 6% vs 5% over many calls: z can be large, lift is only 1.2×.
    const signals = [...many(50, NOW - 5 * DAY, 400, 20), ...many(20, NOW - 3600_000, 400, 24)];
    expect(comparePulse(signals, RECENT, BASELINE)[0].verdict).toBe("normal");
  });

  it("withholds a verdict without enough sessions", () => {
    const signals = [...many(2, NOW - 5 * DAY, 20, 0), ...many(3, NOW - 3600_000, 20, 10)];
    expect(comparePulse(signals, RECENT, BASELINE)[0].verdict).toBe("not enough data");
  });

  it("reports each recently used model separately and skips unused ones", () => {
    const signals = [
      ...many(6, NOW - 5 * DAY, 20, 1),
      ...many(2, NOW - 3600_000, 20, 1),
      ...many(6, NOW - 5 * DAY, 20, 1, "haiku-4-5"),
    ];
    expect(comparePulse(signals, RECENT, BASELINE).map((p) => p.model)).toEqual(["opus-5-5"]);
  });

  it("ignores sessions older than the baseline window", () => {
    const signals = [...many(10, BASELINE - DAY, 20, 0), ...many(3, NOW - 3600_000, 20, 5)];
    expect(comparePulse(signals, RECENT, BASELINE)[0].baseline.sessions).toBe(0);
  });
});

describe("sessionSignals", () => {
  it("counts errors, rephrasings and failed edits, ignoring user interruptions", () => {
    const t = (over: Partial<MergedTurn>): MergedTurn => ({
      role: "user",
      content: [],
      usage: null,
      complete: true,
      timestamp: "2026-10-03T10:00:00Z",
      isHumanTurn: false,
      ...over,
    });
    const session: Session = {
      id: "s",
      projectSlug: "p",
      model: "claude-opus-5-5",
      startTime: "2026-10-03T10:00:00Z",
      endTime: "",
      cwd: "/r",
      gitBranch: null,
      durationMs: 0,
      subagentCount: 0,
      subagentTurnCount: 0,
      formatVersion: "",
      unknownRecordTypes: new Set(),
      turns: [
        t({ isHumanTurn: true, content: [{ type: "text", text: "fix the login bug please" }] }),
        t({ role: "assistant", content: [{ type: "tool_use", id: "a", name: "Edit", input: { file_path: "/r/x.ts" } }] }),
        t({ content: [{ type: "tool_result", tool_use_id: "a", content: "File has not been read yet. Read it first.", is_error: true }] }),
        t({ role: "assistant", content: [{ type: "tool_use", id: "b", name: "Bash", input: { command: "npm test" } }] }),
        t({ content: [{ type: "tool_result", tool_use_id: "b", content: "The user doesn't want to proceed with this tool use.", is_error: true }] }),
        t({ isHumanTurn: true, content: [{ type: "text", text: "fix the login bug, please" }] }),
      ],
    };
    const s = sessionSignals(session);
    expect(s).toMatchObject({
      model: "opus-5-5",
      toolCalls: 1,
      toolErrors: 1,
      messagePairs: 1,
      retries: 1,
      editCalls: 1,
      editFailures: 1,
    });
  });
});

describe("buildSharePayload", () => {
  it("contains only per-model, per-UTC-hour counts", () => {
    const payload = buildSharePayload(
      [
        sig({ startTime: "2026-10-03T10:15:00Z", toolCalls: 5 }),
        sig({ startTime: "2026-10-03T10:45:00Z", toolCalls: 7 }),
        sig({ startTime: "2026-10-03T11:05:00Z", toolCalls: 1 }),
        sig({ startTime: "2026-09-01T00:00:00Z", toolCalls: 99 }),
      ],
      Date.parse("2026-10-02T00:00:00Z"),
      "inspecto/test",
    );
    expect(payload.schema).toBe(1);
    expect(payload.buckets.map((b) => [b.hour, b.sessions, b.toolCalls])).toEqual([
      ["2026-10-03T10", 2, 12],
      ["2026-10-03T11", 1, 1],
    ]);
    const keys = new Set(payload.buckets.flatMap((b) => Object.keys(b)));
    expect([...keys].sort()).toEqual(
      ["editCalls", "editFailures", "hour", "messagePairs", "model", "retries", "sessions", "toolCalls", "toolErrors"],
    );
  });
});
