# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/ via tsup (ESM, Node 22 target)
npm run dev          # Run src/index.ts directly via tsx (no build required)
npm run test         # Run Vitest suite once
npm run test:watch   # Run Vitest in watch mode
npm run lint         # Type-check only (tsc --noEmit, no output emitted)
```

Run a single test file:
```bash
npx vitest run tests/metrics/metrics.test.ts
```

## Architecture

inspecto grades Claude Code sessions by streaming their local JSONL logs and computing 12 quality metrics — no external API calls, no telemetry.

**Data source:** `~/.claude/projects/{projectSlug}/{sessionId}.jsonl`

### Pipeline (linear, no cycles)

```
JSONL file (streaming)
  → getCachedGrade()     [src/cache/grade-cache.ts]     — SQLite lookup by sha256(path:mtime); skip below on hit
  → readJsonl()          [src/parser/jsonl-reader.ts]   — AsyncGenerator, never loads full file
  → buildSession()       [src/parser/session-builder.ts] — merges streaming chunks by message.id
  → gradeSession()       [src/metrics/grader.ts]        — runs all 12 metrics, computes weighted score
  → setCachedGrade()     [src/cache/grade-cache.ts]     — persist result for next run
  → render*Report()      [src/reporter/terminal.ts]     — chalk + cli-table3 output
```

`trend` and `compare` run up to 16 of these pipelines concurrently via `concurrentSettled()` in `src/utils/concurrent.ts`.

### Key implementation details

**Chunk merging:** Claude streams assistant responses as multiple JSONL records sharing a `message.id`. Only the final chunk (where `stop_reason != null`) carries real `output_tokens`. `session-builder.ts` must accumulate text across chunks but take token counts only from the final chunk.

**Token cost accuracy:** `input_tokens` in raw JSONL is a streaming placeholder and must not be used directly. Real input cost = `cache_read_input_tokens + cache_creation_input_tokens`.

**Project discovery:** `src/parser/project-scanner.ts` walks `~/.claude/projects/` and returns session files sorted by mtime. The `--data-dir` flag overrides the default Claude data directory. `SessionFile` includes `birthtime` (from `fs.stat`) for duration estimation in the `list` command.

**CI exit codes:** `audit` sets `process.exitCode = 1` if score < 67 (D or F grade). `trend` sets it if any metric has `status === "regression"`. `cache-check` sets it if any result has `isAnomaly === true`. All suppressed by `options.fail === false` (the `--no-fail` flag via Commander's negation pattern).

### The 12 Metrics (`src/metrics/`)

| File | Metric | Healthy | Weight |
|------|--------|---------|--------|
| `reads-per-edit.ts` | Read tool calls before each Write/Edit | ≥ 4.0 | 14% |
| `rewrite-ratio.ts` | Writes / (Writes + Edits) | ≤ 0.25 | 11% |
| `cache-hit-rate.ts` | cache_read / (cache_read + cache_creation) tokens | ≥ 0.50 | 11% |
| `task-completion.ts` | 1 − (unfulfilled intents / total intents) | ≥ 0.90 | 10% |
| `tokens-per-edit.ts` | Total output tokens / file modification count | ≤ 5,000 | 11% |
| `tool-error-rate.ts` | Tool calls returning errors / total tool calls | ≤ 5% | 8% |
| `retry-density.ts` | Similar consecutive user messages (Levenshtein > 0.6) / pairs | ≤ 0.10 | 7% |
| `thinking-utilization.ts` | Turns using extended thinking / total assistant turns | ≥ 30% | 7% |
| `tool-diversity.ts` | Shannon entropy of tool distribution, normalized 0–1 | ≥ 0.60 | 6% |
| `subagent-overhead.ts` | Subagent turns / total turns | < 0.60 | 5% |
| `mcp-usage.ts` | Count of MCP tool turns (informational, always scores 100) | — | 5% |
| `session-cost.ts` | Estimated session cost in USD | ≤ $2.00 | 5% |

All metrics are pure functions of a `Session` object. To add a new metric: implement it in `src/metrics/`, register it in `grader.ts` with a weight (all weights must sum to 1.0).

### Module responsibilities

- **`src/commands/`** — CLI command handlers (`audit`, `trend`, `cache-check`, `compare`, `list`, `outcomes`, `fleet`, `report`, `fix`, `statusline`, `wrapped`). Each orchestrates: scan → parse → grade → report. `audit` always recomputes; `trend`, `compare`, and `fleet` use the grade cache. `list` uses `scanSessions()` directly without parsing — it only needs file metadata. `report` reuses `collectFleet()` from `fleet.ts` and writes a self-contained HTML file.
- **`src/calibrate/`** — Metric calibration: `stats.ts` holds pure `pearson`/`spearman`/`rank` (ties averaged) implementations; `calibrate.ts` correlates each metric against outcome measures (edit survival, cost per landed commit) and assigns a verdict. Verdicts are withheld below `MIN_SAMPLES` (8) and a metric that fires on ≥50% of sessions with |ρ| < 0.3 is labelled a false alarm. `HIGHER_IS_BETTER` mirrors the grader's scoring so metrics correlating against theory can be flagged. The `calibrate` command parses each session ONCE and derives both its grade and its outcome.
- **`src/outcomes/`** — Outcome verification: links a session to the git commits that carried its work (commits in [session start, end + 24h] touching session-edited files), then measures survival via one `git blame --line-porcelain HEAD` pass per file (lines still attributed to the linked commit). All git access goes through `git.ts`, which returns null/empty on any failure so outcome analysis never breaks a command. Outcome metrics are deliberately NOT part of the 12-metric weighted grade — grader metrics are pure sync functions of `Session`; outcomes need async git access. Git concurrency is capped at 4 (vs 16 for parsing). macOS symlink mismatches (`/var` vs `/private/var`) are handled via `tryRealpath` in `edited-files.ts`.
- **`src/fix/`** — `inspecto fix`: `detect.ts` finds per-session failure events (failed Bash command → same-toolchain command that worked within 3 calls, repeat failures, edit-before-read, stale `old_string`, missing paths) and groups them into findings by stable `ruleId`; `claude-md.ts` merges rules into a marked block in CLAUDE.md, each tagged `<!-- inspecto:rule id=… applied=<ISO> -->`; `verify.ts` compares event rate per session before/after that timestamp (verdict withheld below 3 sessions after). State lives only in CLAUDE.md, never in a side file.
- **`src/statusline/`** — `inspecto statusline`: Claude Code pipes session JSON (`transcript_path`, `cost.total_cost_usd`) on stdin; `summary.ts` grades the transcript into a `StatuslineSummary` (cached in `$TMPDIR/inspecto-statusline/` by size+mtime) and renders one ANSI line with at most one nudge (in-session repeat failures from `fix/detect.ts` first). Rendering must never fail: any error prints `inspecto` and exits 0. `settings.ts` installs/uninstalls `statusLine` in settings.json and never replaces a non-inspecto statusLine without `--force`.
- **`src/wrapped/`** — `inspecto wrapped`: `compute.ts` reduces each session to a small `SessionDigest` (`digestSession`, pure), then `computeWrapped` aggregates digests into year stats, a weekday×hour heatmap and a persona (first match wins in `pickPersona`). Days and hours use the system time zone unless `timeZone` is passed. `html.ts` renders self-contained story cards and hides project/file names unless `showNames` is set — keep that default, since the page is meant to be shared.
- **`src/cache/`** — `grade-cache.ts`: lazy-initialized SQLite DB at `~/.claude/inspecto-cache.db` (via `node:sqlite`, Node 22+). Cache key = `sha256(sessionPath:mtime)`. All reads/writes are wrapped in try/catch — failures log to stderr and are silently skipped so the command always completes.
- **`src/anomaly/`** — Multi-session analysis: `baseline.ts` computes rolling averages, `regression-detector.ts` flags >30% degradation, `cache-anomaly.ts` flags sessions with <5% cache hit rate.
- **`src/reporter/`** — Terminal rendering (`terminal.ts`), structured JSON output (`json-reporter.ts`), and CSV output (`csv-reporter.ts`). `tips.ts` maps metric statuses to context-sensitive improvement messages. `csv-reporter.ts` implements RFC 4180 quoting (fields with commas or quotes are double-quoted).
- **`src/utils/`** — `paths.ts` (cross-platform `~/.claude` resolution + `getCacheFilePath()`), `duration.ts` (parses `7d`/`14d`/`30d`), `levenshtein.ts` (retry detection), `format.ts` (display helpers), `concurrent.ts` (semaphore-based `concurrentSettled`, max 16 in-flight).

### Build output

tsup bundles `src/index.ts` to `dist/index.js` as a single ESM file with a `#!/usr/bin/env node` shebang injected, making it directly executable. `npm run lint` (tsc) and `npm run build` (tsup) are separate steps — passing one does not guarantee the other.
