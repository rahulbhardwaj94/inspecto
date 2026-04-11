/**
 * Discovers Claude Code session files under ~/.claude/projects/.
 *
 * Session files are at: ~/.claude/projects/{project-slug}/{sessionId}.jsonl
 * Subagent files are at: ~/.claude/projects/{project-slug}/{sessionId}/subagents/agent-*.jsonl
 */

import { readdir, stat } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { getClaudeDir } from "../utils/paths.js";
import type { SessionFile } from "./types.js";

/**
 * Scan ~/.claude/projects/ for all main session JSONL files.
 * Returns files sorted by modification time (most recent first).
 */
export async function scanSessions(options?: {
  dataDir?: string;
  project?: string;
  since?: Date;
}): Promise<SessionFile[]> {
  const claudeDir = options?.dataDir ?? getClaudeDir();
  const projectsDir = join(claudeDir, "projects");

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    throw new Error(
      "Claude Code data directory not found. " +
        "Make sure Claude Code is installed and has been used at least once.\n" +
        `Expected: ${projectsDir}`,
    );
  }

  // Filter to specific project if requested
  if (options?.project) {
    projectDirs = projectDirs.filter((dir) =>
      dir.toLowerCase().includes(options.project!.toLowerCase()),
    );
  }

  const sessions: SessionFile[] = [];

  for (const projectDir of projectDirs) {
    // Skip hidden directories
    if (projectDir.startsWith(".")) continue;

    const fullProjectDir = join(projectsDir, projectDir);
    let entries: string[];
    try {
      entries = await readdir(fullProjectDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (extname(entry) !== ".jsonl") continue;

      const filePath = join(fullProjectDir, entry);
      const sessionId = basename(entry, ".jsonl");

      try {
        const fileStat = await stat(filePath);

        // Filter by date if requested
        if (options?.since && fileStat.mtime < options.since) continue;

        sessions.push({
          path: filePath,
          sessionId,
          projectSlug: projectDir,
          mtime: fileStat.mtime,
        });
      } catch {
        continue;
      }
    }
  }

  // Sort most recent first
  sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return sessions;
}

/**
 * Get the most recent session file, optionally filtered by project.
 */
export async function getMostRecentSession(options?: {
  dataDir?: string;
  project?: string;
}): Promise<SessionFile> {
  const sessions = await scanSessions(options);
  if (sessions.length === 0) {
    throw new Error(
      "No Claude Code sessions found. " +
        "Use Claude Code in a project first to generate session data.",
    );
  }
  return sessions[0];
}
