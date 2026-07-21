# inspecto

[![npm version](https://img.shields.io/npm/v/inspecto)](https://www.npmjs.com/package/inspecto)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**Local Claude Code session diagnostics — inspect patterns, detect regressions, catch cache anomalies.**

> 3,211 npm package downloads between April 11 and July 13, 2026.

**Using inspecto?** inspecto is local-only by design — it phones no one home, which means the *only* way we learn what to build next is if you tell us. [Open an issue or share how you use it](https://github.com/rahulbhardwaj94/inspecto/issues), or ⭐ the repo if it saved you a token.

---

## What's New in v1.2.0

- **Privacy-safe history export:** `inspecto export --since 30d` produces pseudonymous per-session metrics for a team baseline without prompts, tool inputs/results, paths, branches, source code, user names, or raw session IDs.
- **Model-aware cost estimates:** uses the model recorded on each turn, distinguishes 5-minute and 1-hour cache writes when available, and supports current Sonnet 5, Opus 4.5+, Haiku 4.5, Fable 5, and Mythos 5 pricing. Verify estimates against Anthropic billing.
- **Commercial-readiness basics:** an actual MIT license, privacy and security documentation, explicit diagnostic disclaimers, and CI on Node.js 22 and 24.
- **Outcome verification, fleet view, HTML reports, and metric calibration** — detailed below.

### Outcome verification — did the work survive?

inspecto now answers a question no session indicator can: **did the work survive?**

### `inspecto outcomes` — link sessions to git and measure survival

```bash
npx inspecto outcomes --since 14d
```

For every session, inspecto finds the commits that carried its work (same repo, commits within the session window + 24h that touch the files the session edited), then uses `git blame` at HEAD to measure how many of those lines are still alive. You get two numbers that exist nowhere else:

- **Edit survival rate** — the fraction of session-authored lines still in your codebase
- **Cost per surviving change** — session cost divided by the commits that actually landed

All git analysis is local (`git log`, `git show`, `git blame`) — no GitHub API, works offline, and sessions outside a git repo are skipped gracefully.

### `inspecto fleet` — every agent run in one view

```bash
npx inspecto fleet --since 7d
```

One table across all projects: session, project, model, duration, turns, subagents, cost, grade — plus total cost and average grade for the window. The morning-after view of everything your agents did.

### `inspecto calibrate` — which metrics actually predict outcomes?

```bash
npx inspecto calibrate --since 90d
```

Every quality tool asserts what "good" looks like. inspecto can now **test that claim against your own history**: it correlates each of the 12 metrics with whether the code from those sessions actually survived in git, and labels each one `predictive`, `weak`, `no signal`, or `FALSE ALARM` (fires constantly, predicts nothing).

It also flags metrics that correlate *opposite* to the grader's own assumption, reports `n` everywhere, and withholds a verdict below 8 linked sessions. Correlation isn't causation and survival has a ceiling effect — the output says so.

### `inspecto report` — a shareable HTML report

```bash
npx inspecto report --since 7d --outcomes
```

Writes a single self-contained `inspecto-report.html` (no external assets, dark/light aware): summary cards, a score-over-time sparkline, per-project rollup, the full fleet table, and — with `--outcomes` — the survival analysis. Drop it in Slack or attach it to a retro.

---

## What's New in v1.1.5

Bug fix: trend analysis no longer misreports improvements as regressions. Metrics where lower is better — `tool-error-rate`, `session-cost`, and `subagent-overhead` — were being flagged as regressions when they *improved* (e.g. a falling error rate showing up as "REGRESSION"). The informational `mcp-usage` metric is also no longer flagged when usage simply drops between windows.

## What's New in v1.1.4

Thank you to everyone who has tried the package. Here's what shipped.

### 5 new diagnostic indicators — 7 → 12

| # | Metric | What it measures |
|---|---|---|
| **M8** | Subagent overhead | Whether Claude is delegating work to subagents efficiently — and whether those subagents are doing meaningful work |
| **M9** | Tool error rate | How often Claude's tool calls return errors. High rates mean Claude is calling tools with bad arguments or on paths that don't exist |
| **M10** | Thinking utilization | Whether extended thinking is actually being used on turns that warrant it. Low utilization on complex sessions often predicts high retry density |
| **M11** | MCP usage | Informational count of MCP tool calls (web search, web fetch, custom servers) per session |
| **M12** | Session cost | Model-aware estimate from recorded token usage and cache duration; Anthropic billing remains the source of truth |

All 12 indicators are pure functions of your local session files. No data leaves your machine unless you explicitly export and share the computed output.

### Watch mode

```bash
npx inspecto watch
```

Streams live metric updates as Claude Code writes to the active session. Grade updates every time a new assistant turn lands. Hit Ctrl-C to exit.

### Per-project config

Drop `.inspecto.json` in your repo root to override thresholds and weights for your team:

```json
{
  "thresholds": {
    "tokensPerEdit": { "healthy": 8000, "warning": 15000 },
    "sessionCost":   { "healthy": 5.00, "warning": 10.00 }
  },
  "weights": {
    "cacheHitRate": 0.20,
    "taskCompletion": 0.20
  }
}
```

Validate your config at any time:

```bash
npx inspecto config validate
```

### 2–3× faster trend and compare

Computed grades are now cached in `~/.claude/inspecto-cache.db` (SQLite via `node:sqlite`). Cache key is `sha256(path:mtime)` — it invalidates automatically when Claude Code appends to a session. Re-runs over unchanged sessions skip parsing entirely. Up to 16 sessions are also parsed in parallel, so a 300-session history finishes in seconds instead of minutes.

### CI exit codes

`audit`, `trend`, and `cache-check` now exit 1 on failures. Drop into any pipeline:

```bash
npx inspecto trend --since 14d   # exits 1 on any regression
npx inspecto audit --no-fail     # warns but never blocks
```

### Other additions

- **`inspecto list`** — discover your projects and sessions before running audit or compare. No more guessing project slugs for `--project`.
- **Metrics-only history export** — `inspecto export --since 30d` produces pseudonymous, per-session metrics without prompts, tool inputs/results, paths, source code, git branches, or raw session IDs.
- **CSV export** — `--format csv` on `audit` and `trend` for dashboards, spreadsheets, and log aggregators.
- **Subagent session aggregation** — inspecto now reads subagent JSONL files (`{sessionId}/subagents/agent-*.jsonl`) and merges them into the parent session. Multi-agent sessions were previously graded with large gaps in tool calls and token usage.
- **Format version detection** — inspecto now reads the `version` field on every JSONL record and warns when the format differs from what it was built against. Unknown record types are surfaced in the output rather than silently dropped.

---

## Why I built this

Anthropic's April 23, 2026 [postmortem](https://www.anthropic.com/engineering/april-23-postmortem) confirmed that multiple Claude Code regressions escaped initial internal reproduction. That makes a customer-specific longitudinal baseline useful—but it does not mean one heuristic can prove that a model, developer, or workflow is productive.

Anthropic Analytics should remain your source of truth for official adoption, contribution, value, and billing data. OpenTelemetry is the right choice when you already operate an observability pipeline. Inspecto adds a ready-made, offline session-behavior baseline for teams that want directional signals without deploying a collector or uploading raw sessions.

---

## What it does

`inspecto` reads the JSONL session logs Claude Code already writes to `~/.claude/projects/` and calculates 12 diagnostic indicators — no API key, no telemetry collector, fully offline.

Use Inspecto to form a testable hypothesis about retries, rewrites, context reads, cache reuse, tool errors, and token patterns. Validate any conclusion against your own delivery, defect, review, and lead-time measures.

> Inspecto is independent and is not affiliated with, endorsed by, or sponsored by Anthropic. Its indicators and composite grade are heuristic diagnostics, not employee-performance ratings or proof of productivity, code quality, or cost savings.

<img width="427" height="338" alt="Screenshot 2026-04-11 at 6 00 37 PM" src="https://github.com/user-attachments/assets/81777511-dd45-4ae0-8382-8e008dd98a7a" />

### The 12 diagnostic indicators

Each indicator is a pure function computed from your local session files.

| # | Metric | What it detects | Healthy |
|---|---|---|---|
| **M1** | Reads-before-edit ratio | Claude editing without reading context first | ≥ 4.0 |
| **M2** | Rewrite ratio | Full-file rewrites instead of surgical edits | ≤ 0.25 |
| **M3** | Cache hit rate | Prompt cache bugs inflating token costs | ≥ 0.50 |
| **M4** | Task completion | "I'll do X" promises without follow-through | ≥ 0.90 |
| **M5** | Retry density | User repeating themselves (proxy for misunderstanding) | ≤ 0.10 |
| **M6** | Tool diversity | Over-reliance on a narrow set of tools (Shannon entropy) | ≥ 0.60 |
| **M7** | Tokens per edit | Token cost per productive action | ≤ 5,000 |
| **M8** | Subagent overhead | Fraction of token work delegated to subagents | < 0.60 |
| **M9** | Tool error rate | Rate of tool calls returning errors | ≤ 5% |
| **M10** | Thinking utilization | Fraction of tool-using turns with extended thinking | ≥ 30% |
| **M11** | MCP usage | Count of MCP tool turns (informational) | — |
| **M12** | Session cost | Total estimated session cost | ≤ $2.00 |

### How it works

Claude Code writes one JSONL session file per conversation to `~/.claude/projects/{project}/{sessionId}.jsonl`. Each line is a JSON record — user messages, assistant responses (streamed as multiple chunks), tool calls, and tool results. Subagent sessions land in `{sessionId}/subagents/agent-*.jsonl`.

`inspecto` streams these files line-by-line (never loading 100MB+ files into memory), merges streaming chunks by `message.id`, aggregates subagent turns into the parent session, extracts tool-use patterns and token usage, and computes the 12 metrics above.

The composite grade is a weighted average mapped to a letter grade from **A+** to **F**.

---

## How to use it

### Install

```bash
npm install -g inspecto
```

Or run without installing:

```bash
npx inspecto
```

Requires Node.js >= 22 (uses the built-in `node:sqlite` module). Works on macOS, Linux, and Windows.

---

### Grade your most recent session

```bash
npx inspecto
```

```
  inspecto v1.1.0 — Claude Code Session Quality Analyzer

  Session: 31f3f224 | my-app | 47 min | claude-opus-4-6

  Overall grade: B+

  Metric                 Value    Status
  ─────────────────────────────────────────
  Reads/edit             4.2      ✓ healthy
  Rewrite ratio          0.18     ✓ healthy
  Cache hit rate         0.73     ✓ healthy
  Task completion        0.95     ✓ healthy
  Retry density          0.08     ✓ healthy
  Tool diversity         0.52     ⚠ warning
  Tokens/useful-edit     3,218    ✓ healthy
  Subagent overhead      0.41     ✓ healthy
  Tool error rate        0.03     ✓ healthy
  Thinking utilization   0.44     ✓ healthy
  MCP usage              7        ✓ healthy
  Session cost           $1.24    ✓ healthy
  ...
```

### Watch a session live

```bash
npx inspecto watch
npx inspecto watch --project my-app
```

Clears and re-renders the full audit report every time Claude Code writes a new turn. Useful during long sessions to catch degradation before it compounds.

### Detect regressions over time

```bash
npx inspecto trend --since 14d
```

Compares the most recent half of your sessions against the full period and flags metrics that have regressed by more than 30%.

### Catch the prompt cache bug

```bash
npx inspecto cache-check
```

On March 31, 2026, the leaked Claude Code source revealed two cache bugs that silently inflate token costs 10-20x. This command detects sessions where the cache hit rate is suspiciously low.

### Discover projects and sessions

```bash
# List all projects with session counts and last-active dates
npx inspecto list

# Show the 20 most recent sessions across all projects
npx inspecto list --sessions

# Show all sessions for a specific project
npx inspecto list --project my-app
```

```
  Projects (9 found)

  ─────────────────────────────────────────────
    Project            Sessions   Last active
  ─────────────────────────────────────────────
    my-app             47         2026-06-08
    api-gateway        12         2026-06-01
    shared-lib          3         2026-05-28
  ─────────────────────────────────────────────
```

### Compare projects

```bash
npx inspecto compare --projects my-app,api-gateway,shared-lib
```

### Manage the grade cache

```bash
npx inspecto cache clear   # delete the cache file (~/.claude/inspecto-cache.db)
```

`inspecto trend` and `inspecto compare` cache computed grades in `~/.claude/inspecto-cache.db`. The cache is keyed by file path + mtime and invalidates automatically when Claude Code writes new data.

---

### CI integration

`inspecto` exits with a non-zero code when quality drops below acceptable thresholds:

| Command | Exits 1 when… |
|---|---|
| `inspecto audit` | Overall grade is D or F (score < 67) |
| `inspecto trend` | Any metric has status `regression` |
| `inspecto cache-check` | Any session has a cache anomaly |
| `inspecto compare` | Never (comparison is informational) |

Use `--no-fail` to always exit 0:

```bash
# In a pre-push hook — warn but don't block
npx inspecto audit --no-fail

# In CI — fail the build on regressions
npx inspecto trend --since 14d

# Export metrics for a dashboard without blocking
npx inspecto audit --format csv --no-fail >> metrics.csv
```

---

### Output formats

```bash
# Structured JSON
npx inspecto audit --json
npx inspecto trend --json

# CSV (RFC 4180)
npx inspecto audit --format csv
npx inspecto trend --format csv

# Pseudonymous per-session history for a private team baseline
npx inspecto export --since 30d > inspecto-metrics.csv
npx inspecto export --since 30d --format json > inspecto-metrics.json
```

`audit --format csv` — one row per metric: `name,value,status,label`

`trend --format csv` — one row per metric: `name,recentAvg,fullAvg,changePercent,status`

`export` — one row per session using generated labels such as `session-001`, `week-1`, and `project-1`. It excludes prompts, tool inputs/results, paths, source code, git branches, user names, and raw session IDs. Review the export before sharing it, just as you would any diagnostic report.

---

### Global options

| Flag | Commands | Description |
|---|---|---|
| `--json` | all | Output structured JSON |
| `--format <fmt>` | `audit`, `trend`, `export` | Output format: `json` or `csv` |
| `--no-fail` | `audit`, `trend`, `cache-check`, `compare` | Always exit 0 |
| `--data-dir <path>` | all | Custom Claude data directory (default: `~/.claude`) |
| `--project <name>` | `audit`, `trend`, `compare`, `list`, `export` | Filter to a specific project |
| `--since <duration>` | `trend`, `cache-check`, `export` | Time range (e.g., `7d`, `14d`, `30d`) |
| `--sessions` | `list` | Show sessions view instead of projects view |
| `--limit <n>` | `outcomes`, `fleet`, `report` | Maximum sessions to analyze (default: 50) |
| `--outcomes` | `report` | Include git outcome verification in the HTML report |
| `--out <path>` | `report` | Output file path (default: `inspecto-report.html`) |
| `--interval <ms>` | `watch` | Polling interval fallback in ms (default: 2000) |

---

### What to do about it

Once inspecto shows you where sessions are degrading, here's how to fix each metric:

| Metric | Symptom | Fix |
|---|---|---|
| **Reads/edit low** | Claude edits files without reading context | Add a `CLAUDE.md` at your project root. Claude reads it at session start — use it to list key files, conventions, and "always read X before touching Y" rules. |
| **Rewrite ratio high** | Claude rewrites entire files instead of making surgical edits | Add to your `CLAUDE.md`: *"Prefer Edit over Write. Never rewrite a file you haven't read. Make the smallest change that solves the problem."* |
| **Cache hit rate low** | Token costs inflating 10-20× silently | Keep conversations shorter — long sessions blow past the cache window. Start a fresh session per task rather than one mega-session per day. If `cache-check` flags you, restart Claude Code entirely (the March 2026 bug was a process-level cache corruption). |
| **Task completion low** | Claude states intent but doesn't follow through | Break large tasks into explicit steps. Tell Claude: *"Complete each step fully before moving to the next. Do not summarize what you're about to do — just do it."* |
| **Retry density high** | You're repeating yourself — Claude keeps misunderstanding | You're probably under-specifying. Provide a concrete example of the output you want in the first message. If retries persist across sessions, the root cause is usually a missing `CLAUDE.md` or a context window that's too wide. |
| **Tool diversity low** | Claude over-relies on a narrow tool set (e.g. only Bash) | Prompt explicitly: *"Use the most specific tool available. Prefer Read over Bash for file reads. Prefer Edit over Write for modifications."* This is also a sign of a degraded model — track it over time with `inspecto trend`. |
| **Tokens/edit high** | High token burn per productive action | Shorten your context. Close irrelevant files in the IDE, trim `CLAUDE.md` to essentials, and use `--project` to scope sessions to one repo at a time. |
| **Subagent overhead high** | Subagents doing most of the work but graded separately | Run `inspecto audit` on the root session — it now aggregates subagent turns automatically. If overhead is still high, your orchestration prompts may be spawning agents that duplicate work. |
| **Tool error rate high** | Claude's tool calls are frequently failing | Usually means Claude is passing bad arguments or calling tools on files that don't exist. Add stricter preconditions in `CLAUDE.md`: *"Verify a file exists before reading it. Verify a path before writing."* |
| **Thinking utilization low** | Extended thinking is rarely being used | For complex tasks, prompt Claude to think before acting: *"Think carefully before making any changes."* Low thinking utilization often correlates with shallow analysis and increased retry density. |
| **Session cost high** | Spending more than expected per session | Scope sessions narrowly — one task, one repo. Use `--project` to avoid scanning large unrelated projects. Frequent cache misses compound cost; check `cache-check` if cost spiked unexpectedly. |

**The single highest-leverage fix:** a well-structured `CLAUDE.md`. It front-loads context so Claude reads less at runtime, forces it to follow project conventions, and survives session restarts without re-explaining yourself.

---

## Development

```bash
git clone https://github.com/rahulbhardwaj94/inspecto.git
cd inspecto
npm install
npm test
npm run build
node dist/index.js
```

Architecture:

```
src/
├── parser/        # Streaming JSONL reader + session builder (merges streaming chunks, aggregates subagents)
├── metrics/       # 12 pure-function quality metrics + composite grader
├── anomaly/       # Baseline computation + regression detection + cache anomaly
├── outcomes/      # Session → git linking + edit survival analysis (log/show/blame)
├── calibrate/     # Correlates metrics against outcomes (pearson/spearman + verdicts)
├── reporter/      # Terminal (chalk + cli-table3), JSON, CSV, and HTML output modes
├── commands/      # audit, trend, export, cache-check, compare, list, watch,
│                  #   outcomes, fleet, calibrate, report
├── cache/         # SQLite grade-result cache (node:sqlite, ~/.claude/inspecto-cache.db)
├── config/        # .inspecto.json config loader + per-metric threshold/weight overrides
└── utils/         # Levenshtein, paths, duration parsing, formatting, concurrency helper
```

Key technical details:
- **Streaming parse**: `readline` + `createReadStream` — never loads full files into memory
- **Subagent aggregation**: discovers `{sessionId}/subagents/agent-*.jsonl`, tags each turn with `agentId`, and merges into the parent session's turn list
- **Chunk deduplication**: assistant responses come as multiple JSONL records sharing `message.id`; content blocks are merged and only the final chunk's `output_tokens` is used
- **No external APIs**: all analysis is local. No network calls. Works offline
- **Model-aware cost estimate**: uses the recorded model and 5-minute/1-hour cache-write split when present. Older aggregate-only logs use the 5-minute write rate. Verify estimates against Anthropic billing
- **Concurrency**: `trend` and `compare` parse up to 16 session files in parallel (semaphore-limited) so large histories don't block
- **Grade cache**: computed `GradeResult` objects are persisted in `~/.claude/inspecto-cache.db` (SQLite via `node:sqlite`). Cache key = `sha256(path:mtime)`. Re-runs over unchanged sessions skip parsing entirely — typically 2–3× faster
- **CI exit codes**: `audit` exits 1 on D/F grades, `trend` exits 1 on any regression, `cache-check` exits 1 on any anomaly. All suppressed by `--no-fail`
- **Format resilience**: reads the `version` field on every JSONL record and warns when the format diverges from the expected version. Unknown record types are surfaced in output rather than silently dropped

---

## Privacy, security, and license

- [Privacy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [MIT License](LICENSE)

Claude and Claude Code are trademarks of Anthropic PBC. Inspecto is independent and is not affiliated with or endorsed by Anthropic.
