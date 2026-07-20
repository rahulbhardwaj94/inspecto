import { describe, expect, it } from "vitest";
import { calibrate, MIN_SAMPLES } from "../../src/calibrate/calibrate.js";
import type { OutcomeSample } from "../../src/calibrate/calibrate.js";
import type { MetricStatus } from "../../src/parser/types.js";

/** Build n samples where `metric` tracks survival exactly (perfect predictor). */
function samples(
  name: string,
  values: number[],
  survivals: (number | null)[],
  status: MetricStatus = "healthy",
): OutcomeSample[] {
  return values.map((value, i) => ({
    metrics: [{ name, value, status, label: String(value) }],
    survivalRate: survivals[i],
    costPerCommit: survivals[i] === null ? null : 10 - (survivals[i] as number) * 5,
  }));
}

const TEN = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

describe("calibrate", () => {
  it("marks a metric that tracks survival as predictive", () => {
    // reads-per-edit is higher-is-better; survival rises with it.
    const report = calibrate(samples("reads-per-edit", TEN, TEN));
    const m = report.metrics[0];

    expect(m.n).toBe(10);
    expect(m.survivalSpearman).toBeCloseTo(1);
    expect(m.verdict).toBe("predictive");
    expect(m.directionMatchesTheory).toBe(true);
  });

  it("flags a constantly-firing metric with no outcome signal as a false alarm", () => {
    // V-shaped survival: unrelated to the metric (spearman ~= -0.02), and the
    // metric is critical in every session — inspecto's own real-world pattern.
    const unrelated = [0.99, 0.95, 0.91, 0.93, 0.9, 0.92, 0.94, 0.9, 0.96, 0.98];
    const report = calibrate(samples("reads-per-edit", TEN, unrelated, "critical"));
    const m = report.metrics[0];

    expect(m.n).toBe(10);
    expect(Math.abs(m.survivalSpearman!)).toBeLessThan(0.3);
    expect(m.firesRate).toBe(1);
    expect(m.verdict).toBe("false-alarm");
  });

  it("withholds a verdict below MIN_SAMPLES", () => {
    const few = TEN.slice(0, MIN_SAMPLES - 1);
    const report = calibrate(samples("reads-per-edit", few, few));
    expect(report.metrics[0].n).toBeLessThan(MIN_SAMPLES);
    expect(report.metrics[0].verdict).toBe("insufficient-data");
  });

  it("detects a metric correlating opposite to the grader's assumption", () => {
    // retry-density is lower-is-better, so rising retries SHOULD lower survival.
    // Here survival rises with retries — theory violated.
    const report = calibrate(samples("retry-density", TEN, TEN));
    const m = report.metrics[0];
    expect(m.survivalSpearman).toBeCloseTo(1);
    expect(m.directionMatchesTheory).toBe(false);
  });

  it("treats metrics with no assumed direction as informational", () => {
    const report = calibrate(samples("mcp-usage", TEN, TEN));
    expect(report.metrics[0].verdict).toBe("informational");
  });

  it("ignores sessions without outcomes but still counts them for fires rate", () => {
    const withNulls = samples(
      "reads-per-edit",
      [0.1, 0.2, 0.3, 0.4],
      [0.9, null, null, 0.5],
      "critical",
    );
    const report = calibrate(withNulls);
    expect(report.sessionsAnalyzed).toBe(4);
    expect(report.sessionsWithOutcomes).toBe(2);
    expect(report.metrics[0].n).toBe(2); // only paired observations
    expect(report.metrics[0].firesRate).toBe(1); // measured across all 4
  });

  it("skips metrics whose value is null", () => {
    const withNullValue: OutcomeSample[] = [
      {
        metrics: [{ name: "session-cost", value: null, status: "healthy", label: "N/A" }],
        survivalRate: 0.9,
        costPerCommit: 5,
      },
    ];
    const report = calibrate(withNullValue);
    expect(report.metrics[0].n).toBe(0);
    expect(report.metrics[0].verdict).toBe("insufficient-data");
  });
});
