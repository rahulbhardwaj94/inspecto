/**
 * Cross-platform path resolution for Claude Code data directories.
 */

import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Returns the Claude Code data directory.
 * macOS/Linux: ~/.claude
 * Windows: %USERPROFILE%\.claude
 */
export function getClaudeDir(): string {
  return join(homedir(), ".claude");
}
