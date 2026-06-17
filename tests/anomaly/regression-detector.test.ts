import { describe, it, expect } from "vitest";
import { detectRegressions } from "../../src/anomaly/regression-detector.js";
import type { MetricAverage } from "../../src/anomaly/baseline.js";

function baseline(
  name: string,
  changePercent: number | null,
): MetricAverage {
  return { name, recentAvg: 0, fullAvg: 0, changePercent };
}

describe("detectRegressions: direction handling", () => {
  it("treats a drop in tool-error-rate as an improvement, not a regression", () => {
    // Fewer errors (recent < full) is GOOD for tool-error-rate.
    const [result] = detectRegressions([baseline("tool-error-rate", -45)]);
    expect(result.status).toBe("stable");
  });

  it("flags a rise in tool-error-rate as a regression", () => {
    const [result] = detectRegressions([baseline("tool-error-rate", 45)]);
    expect(result.status).toBe("regression");
  });

  it("treats a drop in session-cost as an improvement", () => {
    const [result] = detectRegressions([baseline("session-cost", -11)]);
    expect(result.status).toBe("stable");
  });

  it("treats a drop in subagent-overhead as an improvement", () => {
    const [result] = detectRegressions([baseline("subagent-overhead", -40)]);
    expect(result.status).toBe("stable");
  });

  it("flags a >30% drop in a higher-is-better metric as a regression", () => {
    const [result] = detectRegressions([baseline("reads-per-edit", -45)]);
    expect(result.status).toBe("regression");
  });

  it("flags a 10-30% drop in a higher-is-better metric as declining", () => {
    const [result] = detectRegressions([baseline("reads-per-edit", -14)]);
    expect(result.status).toBe("declining");
  });

  it("leaves null change as stable", () => {
    const [result] = detectRegressions([baseline("mcp-usage", null)]);
    expect(result.status).toBe("stable");
  });

  it("never flags the informational mcp-usage metric, even on a large drop", () => {
    const [result] = detectRegressions([baseline("mcp-usage", -80)]);
    expect(result.status).toBe("stable");
  });
});
