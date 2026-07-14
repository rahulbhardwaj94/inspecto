import { describe, expect, it } from "vitest";
import { computeSessionCost } from "../../src/metrics/session-cost.js";
import type { Session, UsageData } from "../../src/parser/types.js";

const ONE_MILLION_SPLIT_CACHE: UsageData = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_input_tokens: 1_000_000,
  cache_read_input_tokens: 1_000_000,
  cache_creation: {
    ephemeral_5m_input_tokens: 500_000,
    ephemeral_1h_input_tokens: 500_000,
  },
};

function session(model: string, startTime = "2026-07-14T00:00:00.000Z"): Session {
  return {
    id: "secret-raw-session-id",
    projectSlug: "private-customer-project",
    model,
    turns: [{
      role: "assistant",
      content: [],
      usage: ONE_MILLION_SPLIT_CACHE,
      complete: true,
      timestamp: startTime,
      isHumanTurn: false,
      model,
    }],
    startTime,
    endTime: startTime,
    cwd: "/private/customer/path",
    gitBranch: "secret-feature",
    durationMs: 0,
    subagentCount: 0,
    subagentTurnCount: 0,
    formatVersion: "2.1.167",
    unknownRecordTypes: new Set(),
  };
}

describe("model-aware session cost", () => {
  it("uses Sonnet 5 introductory pricing before September 2026", () => {
    const result = computeSessionCost(session("claude-sonnet-5"));
    expect(result.value).toBe(15.45);
    expect(result.detail).toMatch(/Model-aware/);
  });

  it("uses standard Sonnet 5 pricing from September 2026", () => {
    const result = computeSessionCost(
      session("claude-sonnet-5", "2026-09-02T00:00:00.000Z"),
    );
    expect(result.value).toBe(23.175);
  });

  it("uses Opus 4.8 pricing from the recorded turn model", () => {
    const result = computeSessionCost(session("claude-opus-4-8"));
    expect(result.value).toBe(38.625);
  });

  it("labels an unknown-model fallback", () => {
    const result = computeSessionCost(session("future-unknown-model"));
    expect(result.detail).toMatch(/fallback|unrecognized/i);
  });
});
