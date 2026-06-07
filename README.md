# inspecto

[![npm version](https://img.shields.io/npm/v/inspecto)](https://www.npmjs.com/package/inspecto)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

**Claude Code session quality analyzer — grade sessions, detect regressions, catch cache bugs.**

> CLI to grade Claude Code sessions — 750+ weekly downloads in first week.



> AMD's AI director manually analyzed 7,000 Claude Code sessions to prove it got worse.
> `inspecto` automates that analysis for every developer.

| | `ccusage` | `claude-usage` | `Claude-Code-Usage-Monitor` | **`inspecto`** |
|---|---|---|---|---|
| Tracks token spend | ✅ | ✅ | ✅ | ✅ |
| Answers *"how much did I spend?"* | ✅ | ✅ | ✅ | ✅ |
| Detects quality regressions | ❌ | ❌ | ❌ | **✅** |
| Grades Claude's behavior | ❌ | ❌ | ❌ | **✅** |
| Catches silent cache bugs | ❌ | ❌ | ❌ | **✅** |
| Flags lazy editing patterns | ❌ | ❌ | ❌ | **✅** |
| Works fully offline, no API key | ✅ | ✅ | ✅ | **✅** |

The others answer *"how much did I spend?"*

`inspecto` answers: **"Is Claude Code getting worse for me — and can I prove it?"**

<img width="427" height="338" alt="Screenshot 2026-04-11 at 6 00 37 PM" src="https://github.com/user-attachments/assets/81777511-dd45-4ae0-8382-8e008dd98a7a" />


---

## Install

```bash
npm install -g inspecto
```

Or run without installing:

```bash
npx inspecto
```

Requires Node.js >= 22 (uses the built-in `node:sqlite` module). Works on macOS, Linux, and Windows.

---

## Usage

### Grade your most recent session

```bash
npx inspecto
```

```
  inspecto v1.0.13 — Claude Code Session Quality Analyzer

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
  ...
```

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

`inspecto trend` and `inspecto compare` cache computed grade results in `~/.claude/inspecto-cache.db` so re-runs over the same sessions are near-instant. The cache is keyed by file path + mtime, so it invalidates automatically when Claude Code writes new data to a session.

```bash
npx inspecto cache clear   # delete the cache file (~/.claude/inspecto-cache.db)
```

---

## CI integration

`inspecto` exits with a non-zero code when quality drops below acceptable thresholds:

| Command | Exits 1 when… |
|---|---|
| `inspecto audit` | Overall grade is D or F (score < 67) |
| `inspecto trend` | Any metric has status `regression` |
| `inspecto cache-check` | Any session has a cache anomaly |
| `inspecto compare` | Never (comparison is informational) |

Use `--no-fail` on any command to always exit 0 — useful for scripts that want the output without failing the pipeline:

```bash
# In a pre-push hook — warn but don't block
npx inspecto audit --no-fail

# In CI — fail the build on regressions
npx inspecto trend --since 14d

# Export metrics for a dashboard without blocking
npx inspecto audit --format csv --no-fail >> metrics.csv
```

---

## Output formats

All commands default to terminal output with color and tables. For scripting:

```bash
# Structured JSON
npx inspecto audit --json
npx inspecto trend --json

# CSV (RFC 4180)
npx inspecto audit --format csv
npx inspecto trend --format csv
```

`audit --format csv` produces one row per metric: `name,value,status,label`

`trend --format csv` produces one row per metric: `name,recentAvg,fullAvg,changePercent,status`

---

## Global options

| Flag | Commands | Description |
|---|---|---|
| `--json` | all | Output structured JSON |
| `--format <fmt>` | `audit`, `trend` | Output format: `json` or `csv` |
| `--no-fail` | `audit`, `trend`, `cache-check`, `compare` | Always exit 0 |
| `--data-dir <path>` | all | Custom Claude data directory (default: `~/.claude`) |
| `--project <name>` | `audit`, `trend`, `compare`, `list` | Filter to a specific project |
| `--since <duration>` | `trend`, `cache-check` | Time range (e.g., `7d`, `14d`, `30d`) |
| `--sessions` | `list` | Show sessions view instead of projects view |

---

## The 12 Quality Metrics

Each metric is a pure function computed from your local session files. No data leaves your machine.

| # | Metric | What it detects | Healthy |
|---|---|---|---|
| **M1** | Reads-before-edit ratio | Claude editing without reading context first | ≥ 4.0 |
| **M2** | Rewrite ratio | Full-file rewrites instead of surgical edits | ≤ 0.25 |
| **M3** | Cache hit rate | Prompt cache bugs inflating token costs | ≥ 0.50 |
| **M4** | Task completion | "I'll do X" promises without follow-through | ≥ 0.90 |
| **M5** | Retry density | User repeating themselves (proxy for misunderstanding) | ≤ 0.10 |
| **M6** | Tool diversity | Over-reliance on a narrow set of tools (Shannon entropy) | ≥ 0.60 |
| **M7** | Tokens per edit | Token cost per productive action | ≤ 5,000 |
| **M8** | Subagent overhead | Fraction of turns delegated to subagents | < 0.60 |
| **M9** | Tool error rate | Rate of tool calls returning errors | ≤ 5% |
| **M10** | Thinking utilization | Fraction of turns using extended thinking | ≥ 30% |
| **M11** | MCP usage | Count of MCP tool turns (informational) | — |
| **M12** | Session cost | Total estimated session cost | ≤ $2.00 |

---

## What to do about it

Once inspecto shows you where your sessions are degrading, here's how to fix each metric:

| Metric | Symptom | Fix |
|---|---|---|
| **Reads/edit low** | Claude edits files without reading context | Add a `CLAUDE.md` at your project root. Claude reads it at session start — use it to list key files, conventions, and "always read X before touching Y" rules. |
| **Rewrite ratio high** | Claude rewrites entire files instead of making surgical edits | Add to your `CLAUDE.md`: *"Prefer Edit over Write. Never rewrite a file you haven't read. Make the smallest change that solves the problem."* |
| **Cache hit rate low** | Token costs inflating 10-20× silently | Keep conversations shorter — long sessions blow past the cache window. Start a fresh session per task rather than one mega-session per day. If `cache-check` flags you, restart Claude Code entirely (the March 2026 bug was a process-level cache corruption). |
| **Task completion low** | Claude states intent but doesn't follow through | Break large tasks into explicit steps. Tell Claude: *"Complete each step fully before moving to the next. Do not summarize what you're about to do — just do it."* |
| **Retry density high** | You're repeating yourself — Claude keeps misunderstanding | You're probably under-specifying. Provide a concrete example of the output you want in the first message. If retries persist across sessions, the root cause is usually a missing `CLAUDE.md` or a context window that's too wide. |
| **Tool diversity low** | Claude over-relies on a narrow tool set (e.g. only Bash) | Prompt explicitly: *"Use the most specific tool available. Prefer Read over Bash for file reads. Prefer Edit over Write for modifications."* This is also a sign of a degraded model — track it over time with `inspecto trend`. |
| **Tokens/edit high** | High token burn per productive action | Shorten your context. Close irrelevant files in the IDE, trim `CLAUDE.md` to essentials, and use `--project` to scope sessions to one repo at a time. |
| **Tool error rate high** | Claude's tool calls are frequently failing | Usually means Claude is passing bad arguments or calling tools on files that don't exist. Add stricter preconditions in `CLAUDE.md`: *"Verify a file exists before reading it. Verify a path before writing."* |
| **Thinking utilization low** | Extended thinking is rarely being used | For complex tasks, prompt Claude to think before acting: *"Think carefully before making any changes."* Low thinking utilization often correlates with shallow analysis and increased retry density. |
| **Session cost high** | Spending more than expected per session | Scope sessions narrowly — one task, one repo. Use `--project` to avoid scanning large unrelated projects. Frequent cache misses compound cost; check `cache-check` if cost spiked unexpectedly. |

**The single highest-leverage fix:** a well-structured `CLAUDE.md`. It front-loads context so Claude reads less at runtime, forces it to follow project conventions, and survives session restarts without re-explaining yourself.

---

## How it works

Claude Code writes one JSONL session file per conversation to `~/.claude/projects/{project}/{sessionId}.jsonl`. Each line is a JSON record — user messages, assistant responses (streamed as multiple chunks), tool calls, and tool results.

`inspecto` streams these files line-by-line (never loading 100MB+ files into memory), merges streaming chunks by `message.id`, extracts tool-use patterns and token usage, and computes the 12 metrics above.

The composite grade is a weighted average mapped to a letter grade from **A+** to **F**. Grades below **D+** (score < 67) trigger a non-zero exit code in CI mode.

---

## Why this exists

In the last 30 days before this tool was built:

- **Apr 7, 2026** — A Reddit post about Claude Code's declining quality hit 1,060 upvotes
- **Apr 6, 2026** — AMD's Director of AI filed a GitHub issue with data from 6,852 sessions proving Claude Code reads code 3x less before editing and rewrites entire files 2x more often than before
- **Mar 31, 2026** — Claude Code's source leaked via npm, revealing 2 cache bugs that silently inflate costs 10-20x
- **Mar 26, 2026** — Users on the $100/mo plan reported burning through limits in 90 minutes instead of 5 hours

The tools that track token spending tell you *what* you used. `inspecto` tells you *whether it was worth it*.

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
├── parser/        # Streaming JSONL reader + session builder (merges streaming chunks)
├── metrics/       # 12 pure-function quality metrics + composite grader
├── anomaly/       # Baseline computation + regression detection + cache anomaly
├── reporter/      # Terminal (chalk + cli-table3), JSON, and CSV output modes
├── commands/      # audit, trend, cache-check, compare, list
├── cache/         # SQLite grade-result cache (node:sqlite, ~/.claude/inspecto-cache.db)
├── config/        # .inspecto.json config loader + per-metric threshold/weight overrides
└── utils/         # Levenshtein, paths, duration parsing, formatting, concurrency helper
```

Key technical details:
- **Streaming parse**: `readline` + `createReadStream` — never loads full files into memory
- **Chunk deduplication**: Assistant responses come as multiple JSONL records sharing `message.id`; content blocks are merged and only the final chunk's `output_tokens` is used
- **No external APIs**: All analysis is local. No network calls. Works offline
- **Real token cost**: `input_tokens` is always a streaming placeholder — actual input = `cache_read_input_tokens + cache_creation_input_tokens`
- **Concurrency**: `trend` and `compare` parse up to 16 session files in parallel (semaphore-limited) so large histories don't block
- **Grade cache**: computed `GradeResult` objects are persisted in `~/.claude/inspecto-cache.db` (SQLite via `node:sqlite`). Cache key = `sha256(path:mtime)`. Re-runs over unchanged sessions skip parsing entirely — typically 2–3× faster
- **CI exit codes**: `audit` exits 1 on D/F grades, `trend` exits 1 on any regression, `cache-check` exits 1 on any anomaly. All suppressed by `--no-fail`

---

## License

MIT
