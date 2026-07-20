/**
 * Extracts the set of files a session edited via Write/Edit/NotebookEdit
 * tool calls.
 *
 * A session is NOT tied to one directory: users cd around, work across repos,
 * and rename or delete directories mid-stream, so `session.cwd` (the first cwd
 * seen) is unreliable. Callers therefore resolve the repository from the edited
 * file paths themselves — `extractEditedFilePaths` returns absolute paths, and
 * `relativizeToRepo` filters them to a chosen repo root.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Session, ToolUseBlock } from "../parser/types.js";

const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/**
 * Resolve symlinks so paths compare correctly (macOS records sessions under
 * /var/... while git reports /private/var/...). Falls back to the input for
 * paths that no longer exist.
 */
export function tryRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Absolute, symlink-resolved paths of every file the session edited, in any
 * directory. Relative tool paths are resolved against `session.cwd`; if the
 * session has no cwd they cannot be resolved and are skipped.
 */
export function extractEditedFilePaths(session: Session): string[] {
  const files = new Set<string>();

  for (const turn of session.turns) {
    if (turn.role !== "assistant") continue;
    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;
      const tool = block as ToolUseBlock;
      if (!EDIT_TOOLS.has(tool.name)) continue;

      const filePath =
        (tool.input.file_path as string | undefined) ??
        (tool.input.notebook_path as string | undefined);
      if (!filePath || typeof filePath !== "string") continue;
      if (!isAbsolute(filePath) && !session.cwd) continue;

      files.add(
        tryRealpath(isAbsolute(filePath) ? filePath : resolve(session.cwd, filePath)),
      );
    }
  }

  return [...files];
}

/**
 * Filter absolute paths to those inside `repoRootDir`, returned as
 * repo-relative POSIX-style paths.
 */
export function relativizeToRepo(absolutePaths: string[], repoRootDir: string): string[] {
  const realRoot = tryRealpath(repoRootDir);
  const out: string[] = [];

  for (const absolute of absolutePaths) {
    const rel = relative(realRoot, absolute);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue; // outside the repo
    out.push(rel.split(sep).join("/"));
  }

  return out;
}

/**
 * Convenience wrapper: repo-relative paths for every file the session edited
 * inside `repoRootDir`.
 */
export function extractEditedFiles(session: Session, repoRootDir: string): string[] {
  return relativizeToRepo(extractEditedFilePaths(session), repoRootDir);
}
