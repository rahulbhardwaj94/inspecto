# Changelog

## 1.4.0

- **`inspecto` with no arguments prints a 30-day summary**: estimated spend, average grade, top projects by spend, and up to three fixes. The fixes cover repeated failures, broken prompt caching, sessions over $50 that make up most of the spend, and requests you kept rephrasing. Supports `--since` and `--json`.
- **Recalibrated grade.** Reads-before-edit and full-file rewrites no longer count toward the grade. They are still shown, marked "info (not graded)". When checked against git outcomes with `inspecto calibrate`, both moved opposite to what the grade assumed, and reads-before-edit flagged about 80% of sessions. Their 25% of the weight went to task completion (18%), tool error rate (16%), retry density (14%) and thinking use (9%). Grades cached under the old weights are recomputed once. Set a weight in `.inspecto.json` to grade either metric again.
- **No more `ExperimentalWarning: SQLite…`** on every run under Node 22.
- **Breaking:** bare `inspecto` used to run `audit`. Scripts and CI jobs that relied on it, including its exit code 1 for D/F grades, should call `inspecto audit`.
- README rewritten in plain language, with real output as evidence. Version history moved here.

## 1.3.0

- **`inspecto wrapped`**: your year in Claude Code as six shareable story cards in one self-contained HTML file. Project and file names are hidden unless you pass `--names`.
- **`inspecto statusline`**: the current session's grade, cost, cache hit rate and one nudge, live in Claude Code's status bar. `install` won't replace a custom statusLine without `--force`.
- **`inspecto fix`**: turns failures that keep recurring in a repo into `CLAUDE.md` rules (`--apply`), then reports whether each rule reduced its failure (`working`, `no change`, `worse`) once 3 or more sessions have run since.

## 1.2.0

- **`inspecto outcomes`**: links sessions to the git commits that carried their work and measures edit survival with `git blame`, plus cost per surviving change. All local.
- **`inspecto fleet`**: one table of every session in a window.
- **`inspecto calibrate`**: tests which metrics predict lasting code in your own history, and flags metrics that fire constantly but predict nothing.
- **`inspecto report`**: a self-contained HTML report, optionally with outcomes.
- **`inspecto export`**: pseudonymous per-session metrics for a team baseline, with no prompts, tool inputs, paths, code or names.
- Model-aware cost estimates, including the split between 5-minute and 1-hour cache writes.
- MIT license file, privacy and security docs, and CI on Node 22 and 24.

## 1.1.5

- Fixed: `trend` flagged improvements as regressions for metrics where lower is better (tool error rate, session cost, subagent share). `mcp-usage` is no longer flagged.

## 1.1.4

- Five new metrics, bringing the total from 7 to 12: subagent overhead, tool error rate, thinking use, MCP use, session cost.
- `inspecto watch` for live grading, and `inspecto list` to find projects and sessions.
- Per-project `.inspecto.json` for thresholds and weights, plus `inspecto config validate`.
- Grade cache in `~/.claude/inspecto-cache.db` and parallel parsing (up to 16 sessions), making `trend` and `compare` 2–3× faster.
- CI exit codes for `audit`, `trend` and `cache-check`, with `--no-fail`.
- CSV output, subagent session aggregation, and warnings when the JSONL log format changes.
