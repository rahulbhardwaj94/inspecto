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

  const projectResults = await Promise.all(
    projectDirs
      .filter((dir) => !dir.startsWith("."))
      .map(async (projectDir) => {
        const fullProjectDir = join(projectsDir, projectDir);
        let entries: string[];
        try {
          entries = await readdir(fullProjectDir);
        } catch {
          return [] as SessionFile[];
        }

        const fileResults = await Promise.all(
          entries
            .filter((entry) => extname(entry) === ".jsonl")
            .map(async (entry) => {
              const filePath = join(fullProjectDir, entry);
              const sessionId = basename(entry, ".jsonl");
              try {
                const fileStat = await stat(filePath);
                if (options?.since && fileStat.mtime < options.since) return null;

                let subagentPaths: string[] | undefined;
                try {
                  const subagentDir = join(fullProjectDir, sessionId, "subagents");
                  const agentFiles = await readdir(subagentDir);
                  const paths = agentFiles
                    .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
                    .map((f) => join(subagentDir, f));
                  if (paths.length > 0) subagentPaths = paths;
                } catch {
                  // No subagents directory — normal for older sessions
                }

                return {
                  path: filePath,
                  sessionId,
                  projectSlug: projectDir,
                  mtime: fileStat.mtime,
                  subagentPaths,
                } as SessionFile;
              } catch {
                return null;
              }
            }),
        );
        return fileResults.filter((f): f is SessionFile => f !== null);
      }),
  );

  const sessions: SessionFile[] = projectResults.flat();

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
