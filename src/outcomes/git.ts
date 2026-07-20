/**
 * Thin async wrappers around the git CLI, scoped to a repository directory.
 *
 * All functions degrade gracefully: a missing git binary, a non-repo
 * directory, or any git error returns an empty/false result rather than
 * throwing, so outcome analysis never breaks a command.
 */

import { execFile } from "node:child_process";

const MAX_BUFFER = 64 * 1024 * 1024; // blame output on large files can be big

export function git(repoDir: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoDir, ...args],
      { maxBuffer: MAX_BUFFER, encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });
}

/** Repo root, so session file paths can be made repo-relative. */
export async function repoRoot(dir: string): Promise<string | null> {
  const out = await git(dir, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() : null;
}

export interface CommitInfo {
  sha: string;
  timestamp: number;
  subject: string;
  files: string[];
}

/**
 * List commits in [since, until] with the files each touched.
 * Uses a NUL-safe record separator so subjects with pipes don't break parsing.
 */
export async function listCommits(
  repoDir: string,
  sinceEpoch: number,
  untilEpoch: number,
): Promise<CommitInfo[]> {
  const out = await git(repoDir, [
    "log",
    `--since=${sinceEpoch}`,
    `--until=${untilEpoch}`,
    "--format=%x01%H%x02%ct%x02%s",
    "--name-only",
    "--no-merges",
  ]);
  if (!out) return [];

  const commits: CommitInfo[] = [];
  for (const chunk of out.split("\x01")) {
    if (!chunk.trim()) continue;
    const [header, ...rest] = chunk.split("\n");
    const [sha, ct, subject] = header.split("\x02");
    if (!sha || !ct) continue;
    const files = rest.map((l) => l.trim()).filter((l) => l.length > 0);
    commits.push({ sha, timestamp: Number(ct), subject: subject ?? "", files });
  }
  return commits;
}

/** Lines added per file by a commit (rename/binary entries are skipped). */
export async function commitAdditions(
  repoDir: string,
  sha: string,
): Promise<Map<string, number>> {
  const additions = new Map<string, number>();
  const out = await git(repoDir, ["show", "--numstat", "--format=", sha]);
  if (!out) return additions;

  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = Number(parts[0]);
    if (Number.isNaN(added)) continue; // binary files show "-"
    additions.set(parts.slice(2).join("\t"), added);
  }
  return additions;
}

/**
 * Count, for one file at HEAD, how many lines are attributed to each commit.
 * Returns an empty map when the file no longer exists (all lines dead).
 */
export async function blameAttribution(
  repoDir: string,
  file: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const out = await git(repoDir, ["blame", "--line-porcelain", "HEAD", "--", file]);
  if (!out) return counts;

  // Porcelain: each line group starts with "<40-hex sha> <orig> <final> [count]"
  for (const line of out.split("\n")) {
    const match = /^([0-9a-f]{40}) \d+ \d+/.exec(line);
    if (match) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}
