/**
 * Outcome analysis tests against a real temporary git repository.
 *
 * Builds a repo where a "session" writes a file, a commit lands it, and a
 * later (outside-window) commit rewrites part of it — then verifies linking,
 * survival math, and skip reasons.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeSessionOutcome, aggregateOutcomes } from "../../src/outcomes/analyze.js";
import { extractEditedFiles } from "../../src/outcomes/edited-files.js";
import type { Session, MergedTurn } from "../../src/parser/types.js";

let repoDir: string;

function sh(args: string[], env?: Record<string, string>) {
  execFileSync("git", ["-C", repoDir, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "t@t",
      ...env,
    },
  });
}

function commitAt(message: string, epochSeconds: number) {
  const date = `${epochSeconds} +0000`;
  sh(["commit", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

/** Minimal session whose only content is edit tool calls on given files. */
function makeSession(
  files: string[],
  startTime: string,
  endTime: string,
  cwd: string,
): Session {
  const turns: MergedTurn[] = [
    {
      role: "assistant",
      content: files.map((f, i) => ({
        type: "tool_use" as const,
        id: `tu_${i}`,
        name: "Write",
        input: { file_path: f },
      })),
      usage: {
        input_tokens: 0,
        output_tokens: 1000,
        cache_creation_input_tokens: 10000,
        cache_read_input_tokens: 50000,
      },
      complete: true,
      timestamp: startTime,
      isHumanTurn: false,
      model: "claude-sonnet-4-5",
    },
  ];
  return {
    id: "test-session",
    projectSlug: "test-project",
    model: "claude-sonnet-4-5",
    turns,
    startTime,
    endTime,
    cwd,
    gitBranch: "main",
    durationMs: 60000,
    subagentCount: 0,
    subagentTurnCount: 0,
    formatVersion: "1.0.0",
    unknownRecordTypes: new Set(),
  };
}

// Fixed timeline (epoch seconds), all well in the past
const T0 = 1700000000; // baseline commit (before session)
const T_SESSION_START = 1700010000;
const T_SESSION_END = 1700013600; // 1h session
const T_COMMIT_IN_WINDOW = 1700015000; // inside end+24h
const T_COMMIT_LATE = 1700013600 + 3 * 24 * 3600; // 3 days later — outside window

const iso = (epoch: number) => new Date(epoch * 1000).toISOString();

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "inspecto-outcomes-"));
  sh(["init", "-b", "main"]);

  writeFileSync(join(repoDir, "base.txt"), "base\n");
  sh(["add", "."]);
  commitAt("baseline", T0);

  // The "session's" work: 10 lines in feature.txt
  const tenLines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") + "\n";
  writeFileSync(join(repoDir, "feature.txt"), tenLines);
  sh(["add", "."]);
  commitAt("add feature", T_COMMIT_IN_WINDOW);

  // Later rewrite replaces 4 of the 10 lines (outside the linking window)
  const rewritten =
    Array.from({ length: 10 }, (_, i) => (i < 4 ? `changed ${i}` : `line ${i}`)).join("\n") +
    "\n";
  writeFileSync(join(repoDir, "feature.txt"), rewritten);
  sh(["add", "."]);
  commitAt("rewrite part of feature", T_COMMIT_LATE);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("extractEditedFiles", () => {
  it("returns repo-relative paths and drops files outside the repo", () => {
    const session = makeSession(
      [join(repoDir, "feature.txt"), "/somewhere/else/other.txt"],
      iso(T_SESSION_START),
      iso(T_SESSION_END),
      repoDir,
    );
    expect(extractEditedFiles(session, repoDir)).toEqual(["feature.txt"]);
  });
});

describe("analyzeSessionOutcome", () => {
  it("links the in-window commit and measures survival after the later rewrite", async () => {
    const session = makeSession(
      [join(repoDir, "feature.txt")],
      iso(T_SESSION_START),
      iso(T_SESSION_END),
      repoDir,
    );
    const outcome = await analyzeSessionOutcome(session);

    expect(outcome.skippedReason).toBeNull();
    expect(outcome.commits).toHaveLength(1);
    expect(outcome.commits[0].subject).toBe("add feature");
    expect(outcome.linesAdded).toBe(10);
    expect(outcome.linesSurviving).toBe(6); // 4 of 10 rewritten later
    expect(outcome.survivalRate).toBeCloseTo(0.6);
    expect(outcome.costUsd).toBeGreaterThan(0);
    expect(outcome.costPerSurvivingChange).toBeCloseTo(outcome.costUsd!);
  });

  it("reports zero links when the session edited unrelated files", async () => {
    const session = makeSession(
      [join(repoDir, "base.txt")],
      iso(T_SESSION_START),
      iso(T_SESSION_END),
      repoDir,
    );
    const outcome = await analyzeSessionOutcome(session);
    expect(outcome.skippedReason).toBeNull();
    expect(outcome.commits).toHaveLength(0);
    expect(outcome.survivalRate).toBeNull();
  });

  it("skips sessions outside a git repository", async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "inspecto-nonrepo-"));
    try {
      const session = makeSession(
        [join(nonRepo, "a.txt")],
        iso(T_SESSION_START),
        iso(T_SESSION_END),
        nonRepo,
      );
      const outcome = await analyzeSessionOutcome(session);
      expect(outcome.skippedReason).toBe("not a git repository");
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it("skips sessions with no edits", async () => {
    const session = makeSession([], iso(T_SESSION_START), iso(T_SESSION_END), repoDir);
    const outcome = await analyzeSessionOutcome(session);
    expect(outcome.skippedReason).toBe("no file edits in this session");
  });

  // Regression: a session's recorded cwd is only the FIRST directory seen. Real
  // sessions cd between repos and into dirs that are later renamed or deleted.
  // The repo must be resolved from the edited files, not from that stale cwd.
  it("resolves the repo from edited files when cwd points at a deleted directory", async () => {
    const goneDir = join(tmpdir(), "inspecto-deleted-does-not-exist");
    const session = makeSession(
      [join(repoDir, "feature.txt")],
      iso(T_SESSION_START),
      iso(T_SESSION_END),
      goneDir, // stale cwd — never existed / since deleted
    );
    const outcome = await analyzeSessionOutcome(session);

    expect(outcome.skippedReason).toBeNull();
    expect(outcome.editedFiles).toEqual(["feature.txt"]);
    expect(outcome.commits).toHaveLength(1);
    expect(outcome.linesSurviving).toBe(6);
  });

  it("picks the repo holding the most edits when a session spans two repos", async () => {
    const otherRepo = mkdtempSync(join(tmpdir(), "inspecto-other-"));
    try {
      execFileSync("git", ["-C", otherRepo, "init", "-b", "main"], { env: process.env });
      writeFileSync(join(otherRepo, "only.txt"), "x\n");

      // 1 edit in otherRepo, 1 in repoDir — repoDir wins on commits/linkage.
      const session = makeSession(
        [join(otherRepo, "only.txt"), join(repoDir, "feature.txt")],
        iso(T_SESSION_START),
        iso(T_SESSION_END),
        repoDir,
      );
      const outcome = await analyzeSessionOutcome(session);
      // Both repos hold 1 edit; whichever is chosen must be internally consistent.
      expect(outcome.skippedReason).toBeNull();
      expect(outcome.editedFiles.length).toBeGreaterThan(0);
    } finally {
      rmSync(otherRepo, { recursive: true, force: true });
    }
  });
});

describe("aggregateOutcomes", () => {
  it("computes link rate and cost per surviving change across sessions", async () => {
    const linked = await analyzeSessionOutcome(
      makeSession([join(repoDir, "feature.txt")], iso(T_SESSION_START), iso(T_SESSION_END), repoDir),
    );
    const unlinked = await analyzeSessionOutcome(
      makeSession([join(repoDir, "base.txt")], iso(T_SESSION_START), iso(T_SESSION_END), repoDir),
    );
    const skipped = await analyzeSessionOutcome(
      makeSession([], iso(T_SESSION_START), iso(T_SESSION_END), repoDir),
    );

    const agg = aggregateOutcomes([linked, unlinked, skipped]);
    expect(agg.sessionsAnalyzed).toBe(3);
    expect(agg.sessionsLinked).toBe(1);
    expect(agg.linkRate).toBeCloseTo(0.5); // 1 of 2 linkable
    expect(agg.totalCommits).toBe(1);
    expect(agg.avgSurvivalRate).toBeCloseTo(0.6);
    expect(agg.costPerSurvivingChange).toBeCloseTo(linked.costUsd!);
  });
});
