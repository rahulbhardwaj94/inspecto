/**
 * Installs or removes inspecto as Claude Code's statusLine in a settings.json.
 * Pure functions over the parsed settings object; the command does the I/O.
 */

export interface StatusLineSetting {
  type: "command";
  command: string;
  padding?: number;
}

export type InstallResult =
  | { ok: true; settings: Record<string, unknown>; replaced: boolean }
  | { ok: false; existing: unknown };

export function isInspectoStatusLine(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const command = (value as { command?: unknown }).command;
  return typeof command === "string" && /\binspecto\b/.test(command) && /\bstatusline\b/.test(command);
}

/**
 * Set `statusLine` to run inspecto. An existing non-inspecto statusLine is
 * only replaced with `force`, so a custom status bar is never lost silently.
 */
export function installStatusLine(
  settings: Record<string, unknown>,
  command: string,
  force = false,
): InstallResult {
  const existing = settings.statusLine;
  if (existing !== undefined && !isInspectoStatusLine(existing) && !force) {
    return { ok: false, existing };
  }
  const statusLine: StatusLineSetting = { type: "command", command, padding: 0 };
  return { ok: true, settings: { ...settings, statusLine }, replaced: existing !== undefined };
}

/** Remove `statusLine` only if it is inspecto's. Returns null when there is nothing to remove. */
export function uninstallStatusLine(settings: Record<string, unknown>): Record<string, unknown> | null {
  if (!isInspectoStatusLine(settings.statusLine)) return null;
  const { statusLine: _removed, ...rest } = settings;
  return rest;
}

/**
 * Quote a path for the statusLine command. Double quotes work in both POSIX sh
 * and cmd.exe; backslashes are left alone so Windows paths survive.
 */
export function quoteArg(arg: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/(["$`])/g, "\\$1")}"`;
}
