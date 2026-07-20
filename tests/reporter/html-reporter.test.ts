import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../../src/reporter/html-reporter.js";
import type { FleetRow } from "../../src/commands/fleet.js";
import type { SessionOutcome } from "../../src/outcomes/types.js";

function row(overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    sessionId: "abcd1234-session",
    projectSlug: "-Users-x-myapp",
    model: "claude-sonnet-5",
    startTime: "2026-07-01T10:00:00Z",
    mtime: "2026-07-01T11:00:00Z",
    durationMs: 60 * 60 * 1000,
    turnCount: 42,
    subagentCount: 0,
    costUsd: 1.23,
    grade: { letter: "B+", score: 88, metrics: [] },
    ...overrides,
  };
}

const outcome: SessionOutcome = {
  sessionId: "abcd1234-session",
  projectSlug: "-Users-x-myapp",
  cwd: "/Users/x/my-app",
  skippedReason: null,
  editedFiles: ["src/a.ts"],
  commits: [
    {
      sha: "f".repeat(40),
      subject: "add feature <script>",
      timestamp: 1751364000,
      matchedFiles: ["src/a.ts"],
      linesAdded: 10,
      linesSurviving: 6,
    },
  ],
  linesAdded: 10,
  linesSurviving: 6,
  survivalRate: 0.6,
  costUsd: 1.23,
  costPerSurvivingChange: 1.23,
};

describe("renderHtmlReport", () => {
  it("renders a complete standalone document with summary and tables", () => {
    const html = renderHtmlReport({
      since: "7d",
      generatedAt: new Date("2026-07-19T00:00:00Z"),
      rows: [row(), row({ sessionId: "second-session", costUsd: 2 })],
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
    expect(html).toContain("last 7d");
    expect(html).toContain("$3.23"); // total cost
    expect(html).toContain("abcd1234");
    expect(html).toContain("myapp");
    expect(html).toContain("<polyline"); // sparkline (2+ rows)
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://"); // fully self-contained
  });

  it("includes the outcomes section and survival numbers when provided", () => {
    const html = renderHtmlReport({
      since: "14d",
      generatedAt: new Date(),
      rows: [row()],
      outcomes: [outcome],
      outcomeAggregate: {
        sessionsAnalyzed: 1,
        sessionsLinked: 1,
        linkRate: 1,
        totalCommits: 1,
        totalLinesAdded: 10,
        totalLinesSurviving: 6,
        avgSurvivalRate: 0.6,
        totalCostUsd: 1.23,
        costPerSurvivingChange: 1.23,
      },
    });

    expect(html).toContain("Edit survival");
    expect(html).toContain("60%");
    expect(html).toContain("Cost / surviving change");
    expect(html).toContain("10 → 6");
  });

  it("escapes HTML in dynamic content", () => {
    const html = renderHtmlReport({
      since: "7d",
      generatedAt: new Date(),
      rows: [row({ projectSlug: "-x-<script>alert(1)</script>" })],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
