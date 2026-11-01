import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { GradeResult } from "../parser/types.js";
import { GRADER_VERSION } from "../metrics/grader.js";
import { getCacheFilePath } from "../utils/paths.js";

let db: DatabaseSync | null = null;

/**
 * Load node:sqlite on first use, swallowing only its ExperimentalWarning.
 * On Node 22 that warning otherwise prints on every run — including inside
 * the status bar — and reads as a crash to a first-time user.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const originalEmit = process.emitWarning;
  process.emitWarning = function (warning: string | Error, ...args: unknown[]) {
    const first = args[0] as string | { type?: string } | undefined;
    const type = typeof first === "string" ? first : first?.type;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
    return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...args);
  } as typeof process.emitWarning;
  try {
    return process.getBuiltinModule("node:sqlite");
  } finally {
    process.emitWarning = originalEmit;
  }
}

function getDb(): DatabaseSync {
  if (!db) {
    const { DatabaseSync } = loadSqlite();
    db = new DatabaseSync(getCacheFilePath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS grade_cache (
        cache_key TEXT PRIMARY KEY,
        grade_result TEXT NOT NULL
      )
    `);
  }
  return db;
}

function makeCacheKey(sessionPath: string, mtime: Date): string {
  return createHash("sha256")
    .update(`${sessionPath}:${mtime.getTime()}:v${GRADER_VERSION}`)
    .digest("hex");
}

export function getCachedGrade(sessionPath: string, mtime: Date): GradeResult | null {
  try {
    const key = makeCacheKey(sessionPath, mtime);
    const stmt = getDb().prepare("SELECT grade_result FROM grade_cache WHERE cache_key = ?");
    const row = stmt.get(key) as { grade_result: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.grade_result) as GradeResult;
  } catch {
    process.stderr.write("[inspecto cache] read error, skipping cache\n");
    return null;
  }
}

export function setCachedGrade(sessionPath: string, mtime: Date, grade: GradeResult): void {
  try {
    const key = makeCacheKey(sessionPath, mtime);
    const stmt = getDb().prepare(
      "INSERT OR REPLACE INTO grade_cache (cache_key, grade_result) VALUES (?, ?)",
    );
    stmt.run(key, JSON.stringify(grade));
  } catch {
    process.stderr.write("[inspecto cache] write error, skipping cache\n");
  }
}
