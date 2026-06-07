import { describe, it, expect } from "vitest";
import { loadFixture } from "../helpers.js";
import {
  computeReadsPerEdit,
  computeRewriteRatio,
  computeCacheHitRate,
  computeTaskCompletion,
  computeRetryDensity,
  computeToolDiversity,
  computeTokensPerEdit,
  gradeSession,
} from "../../src/metrics/index.js";

describe("M1: reads-per-edit", () => {
  it("detects high read-to-edit ratio in healthy session", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeReadsPerEdit(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThanOrEqual(2);
    expect(result.status).not.toBe("critical");
  });

  it("detects low read-to-edit ratio in degraded session", async () => {
    const session = await loadFixture("degraded-session");
    const result = computeReadsPerEdit(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeLessThan(1);
    expect(result.status).toBe("critical");
  });

  it("returns null for sessions with no edits", async () => {
    const session = await loadFixture("minimal-session");
    const result = computeReadsPerEdit(session);
    expect(result.value).toBeNull();
    expect(result.label).toBe("N/A");
  });
});

describe("M2: rewrite-ratio", () => {
  it("detects low rewrite ratio in healthy session", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeRewriteRatio(session);
    expect(result.value).not.toBeNull();
    // Healthy session uses Edit, not Write
    expect(result.value!).toBe(0);
    expect(result.status).toBe("healthy");
  });

  it("detects high rewrite ratio in degraded session", async () => {
    const session = await loadFixture("degraded-session");
    const result = computeRewriteRatio(session);
    expect(result.value).not.toBeNull();
    // Degraded session is all Writes
    expect(result.value!).toBeGreaterThan(0.5);
    expect(result.status).toBe("critical");
  });
});

describe("M3: cache-hit-rate", () => {
  it("detects healthy cache hit rate", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeCacheHitRate(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThanOrEqual(0.5);
    expect(result.status).toBe("healthy");
  });

  it("detects cache bug anomaly", async () => {
    const session = await loadFixture("cache-bug-session");
    const result = computeCacheHitRate(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBe(0);
    expect(result.status).toBe("critical");
  });

  it("never uses raw input_tokens (which is always a placeholder)", async () => {
    // If the metric used raw input_tokens (always 3), the rate would be
    // entirely wrong. This test implicitly verifies correct behavior.
    const session = await loadFixture("healthy-session");
    const result = computeCacheHitRate(session);
    // The healthy fixture uses real cache numbers summing to a sensible value
    expect(result.value!).toBeGreaterThan(0.5);
    expect(result.value!).toBeLessThanOrEqual(1);
  });
});

describe("M4: task-completion", () => {
  it("detects low completion rate in degraded session", async () => {
    const session = await loadFixture("degraded-session");
    const result = computeTaskCompletion(session);
    expect(result.value).not.toBeNull();
    // Degraded fixture has intent phrases that aren't always followed up
    expect(result.value!).toBeLessThan(1);
  });

  it("returns 1 when no intent phrases present", async () => {
    const session = await loadFixture("minimal-session");
    const result = computeTaskCompletion(session);
    expect(result.value).toBe(1);
  });
});

describe("M5: retry-density", () => {
  it("returns 0 for healthy session with distinct messages", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeRetryDensity(session);
    expect(result.value).toBe(0);
  });

  it("returns 0 for single-message session", async () => {
    const session = await loadFixture("minimal-session");
    const result = computeRetryDensity(session);
    expect(result.value).toBe(0);
  });
});

describe("M6: tool-diversity", () => {
  it("detects high diversity in healthy session", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeToolDiversity(session);
    expect(result.value).not.toBeNull();
    // Healthy uses Read, Edit, Bash, Grep, Glob
    expect(result.value!).toBeGreaterThan(0.4);
  });

  it("detects low diversity in degraded session", async () => {
    const session = await loadFixture("degraded-session");
    const result = computeToolDiversity(session);
    expect(result.value).not.toBeNull();
    // Degraded uses only Write
    expect(result.status).toBe("critical");
  });
});

describe("M7: tokens-per-edit", () => {
  it("computes tokens per edit from completed turns", async () => {
    const session = await loadFixture("healthy-session");
    const result = computeTokensPerEdit(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0);
  });

  it("returns null for sessions with no edits", async () => {
    const session = await loadFixture("minimal-session");
    const result = computeTokensPerEdit(session);
    expect(result.value).toBeNull();
  });
});

describe("gradeSession", () => {
  it("gives healthy session a high grade", async () => {
    const session = await loadFixture("healthy-session");
    const grade = gradeSession(session);
    expect(grade.score).toBeGreaterThanOrEqual(75);
    expect(["A+", "A", "A-", "B+", "B", "B-"]).toContain(grade.letter);
  });

  it("gives degraded session a low grade", async () => {
    const session = await loadFixture("degraded-session");
    const grade = gradeSession(session);
    expect(grade.score).toBeLessThan(60);
    expect(["D", "D-", "F"]).toContain(grade.letter);
  });

  it("returns all 8 metrics", async () => {
    const session = await loadFixture("healthy-session");
    const grade = gradeSession(session);
    expect(grade.metrics.length).toBe(8);
  });

  it("handles minimal sessions gracefully", async () => {
    const session = await loadFixture("minimal-session");
    const grade = gradeSession(session);
    // Should not crash, should return some grade
    expect(grade.letter).toBeTruthy();
    expect(grade.score).toBeGreaterThanOrEqual(0);
  });
});
