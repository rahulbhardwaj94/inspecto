import { describe, expect, it } from "vitest";
import { createMetricsOnlyRows } from "../../src/commands/export-metrics.js";
import { exportMetricsOnlyCsv } from "../../src/reporter/csv-reporter.js";
import type { Session } from "../../src/parser/types.js";

function rawSession(id: string, projectSlug: string, startTime: string): Session {
  return {
    id,
    projectSlug,
    model: "claude-sonnet-5",
    turns: [],
    startTime,
    endTime: startTime,
    cwd: "/Users/customer/Secret Product",
    gitBranch: "private-launch",
    durationMs: 0,
    subagentCount: 0,
    subagentTurnCount: 0,
    formatVersion: "2.1.167",
    unknownRecordTypes: new Set(),
  };
}

describe("metrics-only history export", () => {
  it("replaces raw session and project identifiers with generated labels", () => {
    const session = rawSession(
      "raw-session-7f2f9c",
      "-Users-customer-Secret-Product",
      "2026-07-01T10:00:00.000Z",
    );
    const rows = createMetricsOnlyRows([{
      file: {
        path: "/Users/customer/.claude/projects/Secret/raw-session-7f2f9c.jsonl",
        sessionId: session.id,
        projectSlug: session.projectSlug,
        mtime: new Date(session.startTime),
      },
      session,
      grade: {
        letter: "B",
        score: 78,
        metrics: [{ name: "retry-density", value: 0.1, status: "healthy", label: "0.10" }],
      },
    }]);

    const csv = exportMetricsOnlyCsv(rows);
    expect(csv).toContain("session-001");
    expect(csv).toContain("project-1");
    expect(csv).toContain("week-1");
    expect(csv).not.toContain("raw-session-7f2f9c");
    expect(csv).not.toContain("Secret-Product");
    expect(csv).not.toContain("/Users/customer");
    expect(csv).not.toContain("private-launch");
  });
});
