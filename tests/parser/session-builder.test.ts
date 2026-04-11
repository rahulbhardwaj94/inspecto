import { describe, it, expect } from "vitest";
import { loadFixture } from "../helpers.js";

describe("buildSession", () => {
  it("merges streaming chunks by message.id", async () => {
    // The healthy fixture has msg-001 with 3 streaming chunks
    // (thinking → text → tool_use). They should merge into a single turn.
    const session = await loadFixture("healthy-session");
    const firstAssistant = session.turns.find((t) => t.role === "assistant");
    expect(firstAssistant).toBeDefined();
    expect(firstAssistant!.content.length).toBeGreaterThanOrEqual(3);
    // Should have thinking, text, and tool_use blocks from merged chunks
    const types = firstAssistant!.content.map((b) => b.type);
    expect(types).toContain("thinking");
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
  });

  it("captures real output tokens from final chunk only", async () => {
    const session = await loadFixture("healthy-session");
    const firstAssistant = session.turns.find((t) => t.role === "assistant");
    expect(firstAssistant!.usage).not.toBeNull();
    // Final chunk of msg-001 has output_tokens: 150
    expect(firstAssistant!.usage!.output_tokens).toBe(150);
    expect(firstAssistant!.complete).toBe(true);
  });

  it("marks human turns correctly", async () => {
    const session = await loadFixture("healthy-session");
    const humanTurns = session.turns.filter((t) => t.isHumanTurn);
    // Healthy fixture has 2 human turns (initial + follow-up)
    expect(humanTurns.length).toBe(2);
  });

  it("distinguishes human turns from tool-result turns", async () => {
    const session = await loadFixture("healthy-session");
    // User turns include both human messages and tool results
    const userTurns = session.turns.filter((t) => t.role === "user");
    const humanTurns = userTurns.filter((t) => t.isHumanTurn);
    const toolResultTurns = userTurns.filter((t) => !t.isHumanTurn);
    expect(humanTurns.length).toBeLessThan(userTurns.length);
    expect(toolResultTurns.length).toBeGreaterThan(0);
  });

  it("captures session metadata", async () => {
    const session = await loadFixture("minimal-session");
    expect(session.model).toBe("claude-sonnet-4-6");
    expect(session.cwd).toBe("/projects/lib");
    expect(session.gitBranch).toBe("dev");
  });

  it("orders turns chronologically", async () => {
    const session = await loadFixture("healthy-session");
    for (let i = 1; i < session.turns.length; i++) {
      expect(session.turns[i].timestamp >= session.turns[i - 1].timestamp).toBe(true);
    }
  });
});
