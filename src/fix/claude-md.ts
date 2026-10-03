/**
 * Reads and writes the inspecto-managed block inside CLAUDE.md.
 *
 * Each rule carries a marker comment with its id and the time it was applied:
 *
 *   - Run `npx vitest run` instead of `npm test` ... <!-- inspecto:rule id=command-correction-1a2b3c4d applied=2026-10-03T12:00:00.000Z -->
 *
 * The applied timestamp lives in the file itself, so verification needs no
 * extra state and works for every teammate who pulls the CLAUDE.md change.
 * Rule text may be edited freely; only the marker comment must stay.
 */

import type { AppliedRule, FixFinding } from "./types.js";

export const BLOCK_START =
  "<!-- inspecto:fix:start — managed by `inspecto fix`; edit rule text freely, keep the marker comments -->";
export const BLOCK_END = "<!-- inspecto:fix:end -->";
const BLOCK_HEADING = "## Lessons from past sessions";

const START_RE = /<!-- inspecto:fix:start[^>]*-->/;
const RULE_RE = /^[ \t]*(?:[-*][ \t]+)?(.*?)[ \t]*<!-- inspecto:rule id=(\S+) applied=(\S+) -->/gm;

/** Every rule marker in the file, wherever it sits. */
export function parseAppliedRules(content: string): AppliedRule[] {
  const rules: AppliedRule[] = [];
  for (const match of content.matchAll(RULE_RE)) {
    rules.push({ ruleId: match[2], appliedAt: match[3], text: match[1] });
  }
  return rules;
}

export function formatRuleLine(finding: FixFinding, appliedAt: string): string {
  return `- ${finding.rule} <!-- inspecto:rule id=${finding.ruleId} applied=${appliedAt} -->`;
}

/**
 * Return the file content with `findings` added to the managed block.
 * Rules whose id is already in the file are skipped, so re-running is safe.
 */
export function mergeRules(
  content: string,
  findings: FixFinding[],
  appliedAt: string,
): { content: string; added: FixFinding[] } {
  const existing = new Set(parseAppliedRules(content).map((r) => r.ruleId));
  const added = findings.filter((f) => !existing.has(f.ruleId));
  if (added.length === 0) return { content, added };

  const newLines = added.map((f) => formatRuleLine(f, appliedAt));
  const startMatch = START_RE.exec(content);
  const endIndex = startMatch ? content.indexOf(BLOCK_END, startMatch.index) : -1;

  if (startMatch && endIndex !== -1) {
    const before = content.slice(0, endIndex).replace(/\n*$/, "\n");
    return { content: before + newLines.join("\n") + "\n" + content.slice(endIndex), added };
  }

  const block = [BLOCK_START, BLOCK_HEADING, "", ...newLines, BLOCK_END].join("\n");
  if (content.trim() === "") return { content: block + "\n", added };
  return { content: content.replace(/\n*$/, "\n\n") + block + "\n", added };
}
