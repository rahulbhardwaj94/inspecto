/**
 * A single, unobtrusive feedback call-to-action.
 *
 * Only shown on human-readable output in an interactive terminal — never on
 * --json/--format csv (machine consumers) and never when piped or in CI
 * (process.stdout.isTTY is false). inspecto is local-only, so this link is the
 * only feedback channel there is; making it visible is the whole point.
 */

import chalk from "chalk";

const REPO_ISSUES = "https://github.com/rahulbhardwaj94/inspecto/issues";

/** Returns the CTA line, or "" when it should be suppressed. */
export function feedbackCta(): string {
  if (!process.stdout.isTTY) return "";
  return chalk.dim(`  ★ Useful? Star it or tell us what's missing: ${REPO_ISSUES}`);
}
