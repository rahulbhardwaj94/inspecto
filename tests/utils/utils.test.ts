import { describe, it, expect } from "vitest";
import { levenshteinDistance, normalizedSimilarity } from "../../src/utils/levenshtein.js";
import { parseDuration } from "../../src/utils/duration.js";
import { formatNumber, formatDuration, shortSessionId, projectNameFromSlug } from "../../src/utils/format.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns length for empty-to-full transition", () => {
    expect(levenshteinDistance("", "hello")).toBe(5);
    expect(levenshteinDistance("hello", "")).toBe(5);
  });

  it("computes basic edit distance", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });

  it("normalizedSimilarity returns 1 for identical", () => {
    expect(normalizedSimilarity("hello", "hello")).toBe(1);
  });

  it("normalizedSimilarity detects retries (> 0.6 for similar strings)", () => {
    const a = "Please fix the authentication bug";
    const b = "Please fix the auth bug now";
    expect(normalizedSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it("normalizedSimilarity low for unrelated strings", () => {
    const a = "Fix the login bug";
    const b = "Add dark mode toggle";
    expect(normalizedSimilarity(a, b)).toBeLessThan(0.5);
  });
});

describe("parseDuration", () => {
  it("parses 7d correctly", () => {
    const now = new Date("2026-04-10T00:00:00.000Z");
    const result = parseDuration("7d", now);
    expect(result.toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("parses 30d correctly", () => {
    const now = new Date("2026-04-10T00:00:00.000Z");
    const result = parseDuration("30d", now);
    expect(result.toISOString()).toBe("2026-03-11T00:00:00.000Z");
  });

  it("throws on invalid format", () => {
    expect(() => parseDuration("invalid")).toThrow();
    expect(() => parseDuration("7w")).toThrow();
  });
});

describe("format helpers", () => {
  it("formatNumber adds comma separators", () => {
    expect(formatNumber(3218)).toBe("3,218");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("formatDuration handles various ranges", () => {
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(2_820_000)).toBe("47 min");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
  });

  it("shortSessionId truncates UUIDs", () => {
    expect(shortSessionId("d45a7de2-e71d-494c-ae31-55877d1fee7f")).toBe("d45a7de2");
  });

  it("projectNameFromSlug extracts last segment", () => {
    expect(projectNameFromSlug("-Users-foo-Projects-my-app")).toBe("app");
    expect(projectNameFromSlug("-Users-rahulbhardwaj-Documents-Personal-Projects-cc-Audit")).toBe("Audit");
  });
});
