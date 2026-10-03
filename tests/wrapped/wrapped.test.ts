import { describe, expect, it } from "vitest";
import { loadFixture } from "../helpers.js";
import { gradeSession } from "../../src/metrics/grader.js";
import {
  computeWrapped,
  digestSession,
  longestStreak,
  shortModel,
  type SessionDigest,
} from "../../src/wrapped/compute.js";
import { compact, renderWrappedHtml } from "../../src/wrapped/html.js";

function digest(over: Partial<SessionDigest>): SessionDigest {
  return {
    id: "s",
    projectSlug: "-Users-me-app",
    model: "claude-opus-4-6",
    startTime: "2026-03-02T10:00:00.000Z",
    durationMs: 30 * 60_000,
    assistantTurns: 10,
    outputTokens: 1000,
    cacheRead: 800,
    cacheCreation: 200,
    costUsd: 1,
    score: 80,
    letter: "B",
    readsPerEdit: 2,
    subagentCount: 0,
    linesWritten: 100,
    toolCounts: { Read: 5, Edit: 2 },
    editCounts: { "/Users/me/app/src/auth.ts": 2 },
    ...over,
  };
}

describe("digestSession", () => {
  it("counts tools, edits and written lines from a real fixture", async () => {
    const session = await loadFixture("healthy-session");
    const d = digestSession(session, gradeSession(session));
    expect(d.assistantTurns).toBeGreaterThan(0);
    expect(Object.values(d.toolCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(d.costUsd).not.toBeNull();
  });
});

describe("computeWrapped", () => {
  const opts = { year: 2026, timeZone: "UTC" };

  it("aggregates totals, rankings and rhythm", () => {
    const stats = computeWrapped(
      [
        digest({ id: "a", startTime: "2026-03-02T10:00:00Z" }), // Monday
        digest({ id: "b", startTime: "2026-03-03T10:30:00Z", model: "claude-sonnet-5-5" }),
        digest({ id: "c", startTime: "2026-03-03T14:00:00Z", score: 95, letter: "A", projectSlug: "-Users-me-api" }),
      ],
      opts,
    );
    expect(stats.sessions).toBe(3);
    expect(stats.activeDays).toBe(2);
    expect(stats.longestStreak).toBe(2);
    expect(stats.totalHours).toBeCloseTo(1.5);
    expect(stats.linesWritten).toBe(300);
    expect(stats.filesEdited).toBe(1);
    expect(stats.topFiles[0]).toEqual({ name: "auth.ts", count: 6 });
    expect(stats.topTools[0]).toEqual({ name: "Read", count: 15 });
    expect(stats.topModels[0]).toEqual({ name: "opus-4-6", count: 2 });
    expect(stats.topProjects[0]).toEqual({ name: "-Users-me-app", count: 2 });
    expect(stats.busiestHour).toBe(10);
    expect(stats.busiestWeekday).toBe("Tuesday");
    expect(stats.heatmap[0][10]).toBe(1);
    expect(stats.biggestDay).toEqual({ date: "2026-03-03", sessions: 2, costUsd: 2 });
    expect(stats.bestSession).toEqual({ date: "2026-03-03", score: 95, letter: "A" });
    expect(stats.cacheHitRate).toBeCloseTo(0.8);
  });

  it("uses the requested time zone for days and hours", () => {
    const stats = computeWrapped([digest({ startTime: "2026-03-03T02:00:00Z" })], {
      year: 2026,
      timeZone: "America/Los_Angeles",
    });
    expect(stats.busiestHour).toBe(18);
    expect(stats.biggestDay?.date).toBe("2026-03-02");
  });

  it("picks a persona from how the person works", () => {
    const nights = Array.from({ length: 10 }, (_, i) =>
      digest({ id: `n${i}`, startTime: `2026-04-${String(i + 1).padStart(2, "0")}T23:00:00Z` }),
    );
    expect(computeWrapped(nights, opts).persona.name).toBe("The Night Owl");

    const careful = Array.from({ length: 5 }, (_, i) => digest({ id: `s${i}`, readsPerEdit: 6 }));
    expect(computeWrapped(careful, opts).persona.name).toBe("The Surgeon");

    expect(computeWrapped([digest({})], opts).persona.name).toBe("The Builder");
  });
});

describe("helpers", () => {
  it("computes streaks across month boundaries", () => {
    expect(longestStreak(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-05"])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  it("formats compact numbers and model names", () => {
    expect(compact(950)).toBe("950");
    expect(compact(1234)).toBe("1.2k");
    expect(compact(38_412)).toBe("38k");
    expect(compact(2_500_000)).toBe("2.5M");
    expect(shortModel("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
  });
});

describe("renderWrappedHtml", () => {
  const stats = computeWrapped(
    [digest({ projectSlug: "-Users-me-secret<project>", editCounts: { "/x/payroll.ts": 3 } })],
    { year: 2026, timeZone: "UTC" },
  );

  it("hides project and file names by default", () => {
    const html = renderWrappedHtml(stats);
    expect(html).not.toContain("secret");
    expect(html).not.toContain("payroll");
    expect(html).toContain("Project #1");
    expect(html).toContain("•••.ts");
  });

  it("shows escaped names with showNames", () => {
    const html = renderWrappedHtml(stats, { showNames: true });
    expect(html).toContain("payroll.ts");
    expect(html).toContain("project&gt;");
    expect(html).not.toContain("<project>");
  });

  it("is self-contained", () => {
    const html = renderWrappedHtml(stats);
    expect(html).not.toMatch(/<(?:script|link)\b/);
    expect(html).not.toMatch(/src=["']https?:/);
  });
});
