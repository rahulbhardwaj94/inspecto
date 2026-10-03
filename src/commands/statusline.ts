/**
 * Statusline command — a one-line live summary in Claude Code's status bar.
 *
 *   inspecto statusline              render (Claude Code pipes session JSON on stdin)
 *   inspecto statusline install      register it in ~/.claude/settings.json
 *   inspecto statusline uninstall    remove it again
 *
 * Rendering runs on every status refresh, so it must be fast and must never
 * fail loudly: grading is cached per transcript size+mtime in the OS temp dir,
 * and any error prints a plain fallback line with exit code 0.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readJsonl } from "../parser/jsonl-reader.js";
import { buildSession } from "../parser/session-builder.js";
import { loadConfig } from "../config/loader.js";
import { getClaudeDir } from "../utils/paths.js";
import { renderStatusline, summarizeSession, type StatuslineSummary } from "../statusline/summary.js";
import { installStatusLine, quoteArg, uninstallStatusLine } from "../statusline/settings.js";

/** Subset of the JSON Claude Code sends a statusLine command on stdin. */
interface StatusInput {
  session_id?: string;
  transcript_path?: string;
  cost?: { total_cost_usd?: number };
}

export interface StatuslineOptions {
  project?: boolean;
  force?: boolean;
}

export async function runStatusline(action: string | undefined, options: StatuslineOptions): Promise<void> {
  if (action === "install") return install(options);
  if (action === "uninstall") return uninstall(options);
  if (action !== undefined) throw new Error(`Unknown action "${action}". Use install or uninstall.`);

  if (process.stdin.isTTY) {
    console.log("inspecto statusline renders Claude Code's status bar from session JSON on stdin.");
    console.log("Set it up with: inspecto statusline install");
    return;
  }

  try {
    process.stdout.write(await render(await readStdin()) + "\n");
  } catch {
    process.stdout.write("inspecto\n");
  }
}

async function render(raw: string): Promise<string> {
  const input = JSON.parse(raw) as StatusInput;
  const color = !process.env.NO_COLOR;
  const liveCost = typeof input.cost?.total_cost_usd === "number" ? input.cost.total_cost_usd : null;
  const transcript = input.transcript_path;
  if (!transcript) return "inspecto";

  const summary = await getSummary(transcript, input.session_id ?? basename(transcript, ".jsonl"));
  return renderStatusline(summary, { liveCostUsd: liveCost, color });
}

async function getSummary(transcript: string, sessionId: string): Promise<StatuslineSummary> {
  const subagentPaths = await findSubagents(transcript, sessionId);
  const stats = await Promise.all([transcript, ...subagentPaths].map((p) => stat(p)));
  const key = createHash("sha256")
    .update(stats.map((s, i) => `${i}:${s.size}:${s.mtimeMs}`).join("|"))
    .update(transcript)
    .digest("hex");

  const cacheFile = join(tmpdir(), "inspecto-statusline", `${sessionId.replace(/[^\w-]/g, "_")}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as { key: string; summary: StatuslineSummary };
    if (cached.key === key) return cached.summary;
  } catch {
    // No cache yet, or unreadable — recompute.
  }

  const session = await buildSession(
    readJsonl(transcript),
    sessionId,
    basename(dirname(transcript)),
    subagentPaths,
  );
  const summary = summarizeSession(session, loadConfig());

  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ key, summary }), "utf8");
  } catch {
    // Caching is best-effort.
  }
  return summary;
}

async function findSubagents(transcript: string, sessionId: string): Promise<string[]> {
  const dir = join(dirname(transcript), sessionId, "subagents");
  try {
    return (await readdir(dir))
      .filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// install / uninstall
// ---------------------------------------------------------------------------

function settingsPath(options: StatuslineOptions): string {
  return options.project
    ? join(process.cwd(), ".claude", "settings.json")
    : join(getClaudeDir(), "settings.json");
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object; not modifying it.`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The command Claude Code should run. Points at this exact script so it works
 * without inspecto on PATH; a throwaway npx cache path falls back to npx.
 */
function statuslineCommand(): { command: string; warning?: string } {
  const script = process.argv[1];
  if (!script || /[\\/]_npx[\\/]/.test(script)) {
    return {
      command: "npx -y inspecto statusline",
      warning:
        "Running via npx adds startup latency to every status refresh. For a snappier status bar: npm i -g inspecto && inspecto statusline install",
    };
  }
  return { command: `node ${quoteArg(script)} statusline` };
}

async function install(options: StatuslineOptions): Promise<void> {
  const path = settingsPath(options);
  const settings = await readSettings(path);
  const { command, warning } = statuslineCommand();
  const result = installStatusLine(settings, command, options.force);

  if (!result.ok) {
    console.log(`A statusLine is already configured in ${path}:`);
    console.log(`  ${JSON.stringify(result.existing)}`);
    console.log("Re-run with --force to replace it.");
    process.exitCode = 1;
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result.settings, null, 2) + "\n", "utf8");
  console.log(`✓ inspecto statusline ${result.replaced ? "updated" : "installed"} in ${path}`);
  console.log(`  command: ${command}`);
  if (warning) console.log(`  note: ${warning}`);
  console.log("  It appears on the next Claude Code status refresh.");
}

async function uninstall(options: StatuslineOptions): Promise<void> {
  const path = settingsPath(options);
  const updated = uninstallStatusLine(await readSettings(path));
  if (!updated) {
    console.log(`No inspecto statusLine found in ${path}.`);
    return;
  }
  await writeFile(path, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(`✓ Removed inspecto statusline from ${path}`);
}
