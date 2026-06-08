/**
 * E2E test: single synthetic session exercising all 12 metrics.
 *
 * The session is built directly as a Session object (bypassing the JSONL
 * parser) so each metric's inputs are precise and assertions are exact.
 *
 * Session narrative:
 *   Act 1 — Fix auth bug:     4 Reads → Edit (reads-per-edit: 4)
 *   Act 2 — Add rate limit:   4 Reads → Edit (reads-per-edit: 4)
 *   Act 3 — Test + deploy:    Bash, Grep, Glob → Write (0 reads before write)
 *                             + 1 MCP tool call
 *   Subagent — agent-sub1:    1 Read turn (no edit)
 *
 * Expected metric values (computed by hand below each describe block):
 *   reads-per-edit      → avg 2.67 (warning)   [4, 4, 0] / 3
 *   rewrite-ratio       → 0.33   (warning)      1 Write / 3 total
 *   cache-hit-rate      → ~0.83  (healthy)      163 000 / 195 500 tokens
 *   task-completion     → 1.00   (healthy)      2 intent phrases, both fulfilled
 *   tokens-per-edit     → 1200   (healthy)      3600 output tokens / 3 edits
 *   tool-error-rate     → 0.0625 (warning)      1 error / 16 tool results
 *   retry-density       → 0      (healthy)      3 distinct human messages
 *   thinking-util       → ~0.24  (warning)      4 thinking turns / 17 assistant turns
 *   tool-diversity      → ~0.66  (healthy)      7 unique tools, Shannon entropy
 *   subagent-overhead   → ~0.89  (critical)     3200 main / 3600 total output tokens
 *   mcp-usage           → ~0.06  (healthy)      1 MCP turn / 16 tool-using turns
 *   session-cost        → ~$0.22 (healthy)      3600 out + 32 500 create + 163 000 read tokens
 */

import { describe, it, expect, beforeAll } from "vitest";
import type {
  Session,
  MergedTurn,
  ContentBlock,
  UsageData,
} from "../../src/parser/types.js";
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
import { computeSubagentOverhead } from "../../src/metrics/subagent-overhead.js";
import { computeToolErrorRate } from "../../src/metrics/tool-error-rate.js";
import { computeThinkingUtilization } from "../../src/metrics/thinking-utilization.js";
import { computeMcpUsage } from "../../src/metrics/mcp-usage.js";
import { computeSessionCost } from "../../src/metrics/session-cost.js";

// ---------------------------------------------------------------------------
// Session factory helpers
// ---------------------------------------------------------------------------

const DEFAULT_USAGE: UsageData = {
  input_tokens: 3,
  output_tokens: 200,
  cache_creation_input_tokens: 2000,
  cache_read_input_tokens: 10000,
};

const SUBAGENT_USAGE: UsageData = {
  input_tokens: 3,
  output_tokens: 400,
  cache_creation_input_tokens: 500,
  cache_read_input_tokens: 3000,
};

function ts(offsetSec: number): string {
  return new Date(
    new Date("2026-01-01T10:00:00.000Z").getTime() + offsetSec * 1000,
  ).toISOString();
}

function humanTurn(text: string, offset: number): MergedTurn {
  return {
    role: "user",
    content: [{ type: "text", text }],
    usage: null,
    complete: true,
    timestamp: ts(offset),
    isHumanTurn: true,
  };
}

function toolResultTurn(
  toolUseId: string,
  content: string,
  offset: number,
  isError = false,
): MergedTurn {
  return {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError },
    ],
    usage: null,
    complete: true,
    timestamp: ts(offset),
    isHumanTurn: false,
  };
}

function assistantTurn(
  blocks: ContentBlock[],
  offset: number,
  usage: UsageData = DEFAULT_USAGE,
  agentId?: string,
): MergedTurn {
  return {
    role: "assistant",
    content: blocks,
    usage,
    complete: true,
    timestamp: ts(offset),
    isHumanTurn: false,
    model: "claude-opus-4-6",
    agentId,
  };
}

function toolUse(id: string, name: string): ContentBlock {
  return { type: "tool_use", id, name, input: {} };
}

function thinkingBlock(t: string): ContentBlock {
  return { type: "thinking", thinking: t };
}

function textBlock(t: string): ContentBlock {
  return { type: "text", text: t };
}

// ---------------------------------------------------------------------------
// Build the synthetic session
// ---------------------------------------------------------------------------

function buildSession(): Session {
  const turns: MergedTurn[] = [
    // ---- ACT 1: Fix authentication bug ----

    // Human prompt #1 (isHumanTurn=true)
    humanTurn("Fix the authentication bug in auth.ts", 0),

    // 4 consecutive Reads before the first Edit
    assistantTurn([thinkingBlock("I need to read the auth file first."), toolUse("t1", "Read")], 1),
    toolResultTurn("t1", "export function login(user, pass) { ... }", 2),

    assistantTurn([toolUse("t2", "Read")], 3),
    toolResultTurn("t2", "describe('login', () => { ... })", 4),

    assistantTurn([toolUse("t3", "Read")], 5),
    // Intentional error (1 of 16 total tool results) — exercises tool-error-rate
    toolResultTurn("t3", "File not found: types.ts", 6, true),

    assistantTurn([toolUse("t4", "Read")], 7),
    toolResultTurn("t4", "export const AUTH_SECRET = process.env.SECRET", 8),

    // Edit #1 — intent phrase ("Let me …") fulfilled by tool use — exercises task-completion
    // reads-per-edit snapshot: [4]
    assistantTurn(
      [
        thinkingBlock("Found the bug: password comparison without hashing."),
        textBlock("Let me fix the authentication logic now."),
        toolUse("t5", "Edit"),
      ],
      9,
    ),
    toolResultTurn("t5", "Edit applied successfully.", 10),

    // ---- ACT 2: Add rate limiting ----

    // Human prompt #2 (very different text — exercises retry-density: not similar)
    humanTurn("Now add rate limiting to the login API endpoint", 11),

    // 4 more Reads before the second Edit
    assistantTurn([thinkingBlock("Let me read the middleware setup first."), toolUse("t6", "Read")], 12),
    toolResultTurn("t6", "export const authMiddleware = (req, res, next) => { ... }", 13),

    assistantTurn([toolUse("t7", "Read")], 14),
    toolResultTurn("t7", "app.post('/login', authMiddleware, loginHandler)", 15),

    assistantTurn([toolUse("t8", "Read")], 16),
    toolResultTurn("t8", '{ "name": "my-app", "dependencies": { "express-rate-limit": "^7.0" } }', 17),

    assistantTurn([toolUse("t9", "Read")], 18),
    toolResultTurn("t9", "const app = express();", 19),

    // Edit #2 — intent phrase ("I'll update …") fulfilled by tool use — exercises task-completion
    // reads-per-edit snapshot: [4, 4]
    assistantTurn(
      [
        thinkingBlock("I'll add the rate limiter to the middleware."),
        textBlock("I'll update the middleware to enforce rate limiting."),
        toolUse("t10", "Edit"),
      ],
      20,
    ),
    toolResultTurn("t10", "Edit applied successfully.", 21),

    // ---- ACT 3: Tests and deploy ----

    // Human prompt #3 (different from both previous — exercises retry-density)
    humanTurn("Run the tests and deploy the changes", 22),

    // Bash — exercises tool-diversity
    assistantTurn([toolUse("t11", "Bash")], 23),
    toolResultTurn("t11", "Tests: 14 passed, 0 failed", 24),

    // Grep — exercises tool-diversity
    assistantTurn([toolUse("t12", "Grep")], 25),
    toolResultTurn("t12", "src/auth.ts:5: if (hash(pass) === stored)", 26),

    // Glob — exercises tool-diversity
    assistantTurn([toolUse("t13", "Glob")], 27),
    toolResultTurn("t13", "src/auth.ts\nsrc/middleware.ts\nsrc/routes.ts", 28),

    // Write — exercises rewrite-ratio (1 Write vs 2 Edits → ratio 0.33)
    // reads-per-edit snapshot: [4, 4, 0]  (0 reads since last edit)
    assistantTurn([toolUse("t14", "Write")], 29),
    toolResultTurn("t14", "File written successfully.", 30),

    // MCP tool call — exercises mcp-usage
    assistantTurn([toolUse("t15", "mcp__filesystem__read")], 31),
    toolResultTurn("t15", "deploy config contents...", 32),

    // End-turn text (no tool use — still counted in thinking-utilization denominator)
    assistantTurn(
      [textBlock("All done! Auth bug fixed, rate limiting added, tests passing, deployment ready.")],
      33,
    ),

    // ---- SUBAGENT TURNS (agentId set) — exercises subagent-overhead ----
    assistantTurn([toolUse("sa1", "Read")], 34, SUBAGENT_USAGE, "agent-sub1"),
    toolResultTurn("sa1", "subagent read result...", 35),
  ];

  return {
    id: "e2e-all-metrics",
    projectSlug: "my-project",
    model: "claude-opus-4-6",
    turns,
    startTime: ts(0),
    endTime: ts(35),
    cwd: "/projects/my-app",
    gitBranch: "main",
    durationMs: 35_000,
    subagentCount: 1,
    subagentTurnCount: 2,
    formatVersion: "2.1.85",
    unknownRecordTypes: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let session: Session;

beforeAll(() => {
  session = buildSession();
});

describe("M1: reads-per-edit", () => {
  it("computes average reads before each write/edit", () => {
    // ratios = [4 (before Edit#1), 4 (before Edit#2), 0 (before Write)] → avg ≈ 2.67
    const result = computeReadsPerEdit(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeCloseTo(2.67, 1);
    expect(result.status).toBe("warning");
  });
});

describe("M2: rewrite-ratio", () => {
  it("computes ratio of Write to total file modifications", () => {
    // Writes=1, Edits=2 → ratio = 1/3 ≈ 0.33
    const result = computeRewriteRatio(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeCloseTo(0.33, 2);
    expect(result.status).toBe("warning");
  });
});

describe("M3: cache-hit-rate", () => {
  it("computes cache read / (read + creation) token ratio", () => {
    // 16 main turns × 10 000 read + 1 SA × 3 000 = 163 000 read
    // 16 main turns × 2 000 create + 1 SA × 500 = 32 500 create
    // rate = 163000 / 195500 ≈ 0.834
    const result = computeCacheHitRate(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0.8);
    expect(result.value!).toBeLessThanOrEqual(1);
    expect(result.status).toBe("healthy");
  });
});

describe("M4: task-completion", () => {
  it("detects fulfilled intent phrases in assistant turns", () => {
    // T10 "Let me fix …" + Edit → fulfilled
    // T21 "I'll update …" + Edit → fulfilled
    // rate = 2/2 = 1.0
    const result = computeTaskCompletion(session);
    expect(result.value).toBe(1);
    expect(result.status).toBe("healthy");
  });
});

describe("M5: tokens-per-edit", () => {
  it("computes total output tokens divided by edit count", () => {
    // 16 main turns × 200 + 1 SA × 400 = 3600 total output tokens
    // 3 file ops (Edit#1, Edit#2, Write) → 3600 / 3 = 1200
    const result = computeTokensPerEdit(session);
    expect(result.value).not.toBeNull();
    expect(result.value).toBe(1200);
    expect(result.status).toBe("healthy");
  });
});

describe("M6: tool-error-rate", () => {
  it("computes fraction of tool results that are errors", () => {
    // 1 error (T7) / 16 total tool result blocks = 0.0625
    const result = computeToolErrorRate(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeCloseTo(0.0625, 4);
    expect(result.status).toBe("warning");
  });
});

describe("M7: retry-density", () => {
  it("returns 0 for distinct human messages", () => {
    // 3 human turns with very different text → 0 retries
    const result = computeRetryDensity(session);
    expect(result.value).toBe(0);
    expect(result.status).toBe("healthy");
  });
});

describe("M8: thinking-utilization", () => {
  it("computes fraction of assistant turns that use extended thinking", () => {
    // Thinking in: T2, T10, T13, T21 = 4 turns
    // Total assistant turns = 17 (16 main + 1 SA)
    // ratio = 4/17 ≈ 0.235
    const result = computeThinkingUtilization(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0.1);
    expect(result.value!).toBeLessThan(0.3);
    expect(result.status).toBe("warning");
  });
});

describe("M9: tool-diversity", () => {
  it("computes Shannon entropy over tool distribution (7 unique tools)", () => {
    // Tools: Read(×9), Edit(×2), Bash, Grep, Glob, Write, mcp__filesystem__read (×1 each)
    // Normalized Shannon entropy ≈ 0.66 → healthy
    const result = computeToolDiversity(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThanOrEqual(0.6);
    expect(result.status).toBe("healthy");
  });
});

describe("M10: subagent-overhead", () => {
  it("computes main agent share of total output tokens", () => {
    // main = 16 × 200 = 3200, subagent = 400 → ratio = 3200/3600 ≈ 0.89
    const result = computeSubagentOverhead(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0.85);
    expect(result.status).toBe("critical");
  });
});

describe("M11: mcp-usage", () => {
  it("detects MCP tool turns and is always healthy", () => {
    // 1 mcp__ tool call (T32) out of 16 assistant turns with tool use
    const result = computeMcpUsage(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0);
    expect(result.label).toBe("1 turn");
    expect(result.status).toBe("healthy");
  });
});

describe("M12: session-cost", () => {
  it("estimates session cost from token usage", () => {
    // output=3600, cacheCreate=32500, cacheRead=163000 → ≈$0.22
    const result = computeSessionCost(session);
    expect(result.value).not.toBeNull();
    expect(result.value!).toBeGreaterThan(0.1);
    expect(result.value!).toBeLessThan(2.0);
    expect(result.status).toBe("healthy");
  });
});

describe("gradeSession (all 12 metrics end-to-end)", () => {
  it("returns all 12 metrics", () => {
    const grade = gradeSession(session);
    expect(grade.metrics).toHaveLength(12);
  });

  it("returns a valid letter grade and numeric score", () => {
    const grade = gradeSession(session);
    expect(grade.score).toBeGreaterThan(0);
    expect(grade.score).toBeLessThanOrEqual(100);
    expect(grade.letter).toMatch(/^[A-F][+-]?$/);
  });

  it("each metric result has the required fields", () => {
    const grade = gradeSession(session);
    const EXPECTED_NAMES = [
      "reads-per-edit",
      "rewrite-ratio",
      "cache-hit-rate",
      "task-completion",
      "retry-density",
      "tool-diversity",
      "tokens-per-edit",
      "subagent-overhead",
      "tool-error-rate",
      "thinking-utilization",
      "mcp-usage",
      "session-cost",
    ];
    const returnedNames = grade.metrics.map((m) => m.name);
    for (const name of EXPECTED_NAMES) {
      expect(returnedNames).toContain(name);
    }
    for (const metric of grade.metrics) {
      expect(["healthy", "warning", "critical"]).toContain(metric.status);
      expect(typeof metric.label).toBe("string");
    }
  });

  it("weighted score reflects healthy cache and cost metrics", () => {
    // cache-hit-rate (healthy) and session-cost (healthy) are weighted;
    // overall score should be above 50 despite some warning/critical metrics
    const grade = gradeSession(session);
    expect(grade.score).toBeGreaterThan(50);
  });
});
