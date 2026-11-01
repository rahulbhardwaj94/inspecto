import { describe, expect, it } from "vitest";
import { computeSummary, MAX_ACTIONS, type SessionDigest } from "../../src/summary/compute.js";
import { renderSummary } from "../../src/commands/summary.js";
import { makeRuleId } from "../../src/fix/detect.js";
import type { FixEvent } from "../../src/fix/types.js";

function digest(overrides: Partial<SessionDigest> = {}): SessionDigest {
  return {
    sessionId: "s",
    projectSlug: "-Users-me-alpha",
    costUsd: 1,
    score: 80,
    cacheAnomaly: false,
    retryStatus: "healthy",
    events: [],
    ...overrides,
  };
}

const editBeforeRead = (n: number): FixEvent[] =>
  Array.from({ length: n }, () => ({
    ruleId: makeRuleId("edit-before-read", ""),
    kind: "edit-before-read" as const,
    subject: "src/a.ts",
  }));

describe("computeSummary", () => {
  it("totals sessions, projects, spend and average grade", () => {
    const s = computeSummary([
      digest({ sessionId: "a", costUsd: 3, score: 90 }),
      digest({ sessionId: "b", costUsd: 1, score: 70, projectSlug: "-Users-me-beta" }),
    ]);
    expect(s.sessions).toBe(2);
    expect(s.projects).toBe(2);
    expect(s.totalCostUsd).toBe(4);
    expect(s.avgScore).toBe(80);
    expect(s.avgLetter).toBe("B-");
    expect(s.topProjects.map((p) => p.projectSlug)).toEqual(["-Users-me-alpha", "-Users-me-beta"]);
  });

  it("returns no actions for a clean history", () => {
    const s = computeSummary([digest({ sessionId: "a" }), digest({ sessionId: "b" })]);
    expect(s.actions).toEqual([]);
  });

  it("ignores failures that recur fewer than 3 times", () => {
    const s = computeSummary([digest({ events: editBeforeRead(2) })]);
    expect(s.actions).toEqual([]);
  });

  it("merges the same lesson across projects and totals its count", () => {
    const s = computeSummary([
      digest({ sessionId: "a", events: editBeforeRead(5) }),
      digest({ sessionId: "b", projectSlug: "-Users-me-beta", events: editBeforeRead(3) }),
    ]);
    const failures = s.actions.filter((a) => a.kind === "repeat-failure");
    expect(failures).toHaveLength(1);
    const [action] = failures;
    if (action.kind !== "repeat-failure") throw new Error("unreachable");
    expect(action.projectSlugs).toEqual(["-Users-me-alpha", "-Users-me-beta"]);
    expect(action.finding.occurrences).toBe(8);
    expect(action.finding.evidence).toMatch(/^8 edits/);
  });

  it("flags expensive sessions only when they carry most of the spend", () => {
    const heavy = computeSummary([
      digest({ sessionId: "a", costUsd: 120 }),
      digest({ sessionId: "b", costUsd: 10 }),
    ]);
    expect(heavy.actions).toEqual([
      expect.objectContaining({ kind: "expensive-sessions", sessions: 1, costUsd: 120 }),
    ]);

    const spread = computeSummary([
      digest({ sessionId: "a", costUsd: 60 }),
      ...Array.from({ length: 20 }, (_, i) => digest({ sessionId: `c${i}`, costUsd: 10 })),
    ]);
    expect(spread.actions.some((a) => a.kind === "expensive-sessions")).toBe(false);
  });

  it("orders actions failure → cache → cost → retries and caps them", () => {
    const s = computeSummary([
      digest({ sessionId: "a", costUsd: 200, cacheAnomaly: true, retryStatus: "critical", events: editBeforeRead(4) }),
      digest({ sessionId: "b", costUsd: 1 }),
    ]);
    expect(s.actions.map((a) => a.kind)).toEqual(["repeat-failure", "cache-anomaly", "expensive-sessions"]);
    expect(s.actions).toHaveLength(MAX_ACTIONS);
  });
});

describe("renderSummary", () => {
  it("explains an empty window instead of printing zeros", () => {
    const out = renderSummary(computeSummary([]), "30d");
    expect(out).toContain("No sessions found in the last 30d.");
    expect(out).not.toContain("Fix these first");
  });

  it("shows spend, actions and next commands", () => {
    const out = renderSummary(
      computeSummary([digest({ costUsd: 120, events: editBeforeRead(3) }), digest({ sessionId: "b" })]),
      "30d",
    );
    expect(out).toContain("$121.00");
    expect(out).toContain("Fix these first");
    expect(out).toContain("inspecto fix --apply");
    expect(out).toContain("inspecto statusline install");
  });
});
