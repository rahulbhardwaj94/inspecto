# inspecto

[![npm version](https://img.shields.io/npm/v/inspecto)](https://www.npmjs.com/package/inspecto)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**Claude Code session quality analyzer — grade sessions, detect regressions, catch cache bugs.**

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

---

## Install

```bash
npm install -g inspecto
```

Or run without installing:

```bash
npx inspecto
```

Requires Node.js >= 18. Works on macOS, Linux, and Windows.

---

## Usage

### Grade your most recent session

```bash
npx inspecto
```

```
  inspecto v1.0.0 — Claude Code Session Quality Analyzer

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

### Compare projects

```bash
npx inspecto compare --projects my-app,api-gateway,shared-lib
```

### Global options

| Flag | Description |
|---|---|
| `--json` | Output structured JSON (for CI, piping, scripts) |
| `--data-dir <path>` | Custom Claude data directory (default: `~/.claude`) |
| `--project <name>` | Filter to a specific project |
| `--since <duration>` | Time range (e.g., `7d`, `14d`, `30d`) |

---

## The 7 Quality Metrics

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

---

## How it works

Claude Code writes one JSONL session file per conversation to `~/.claude/projects/{project}/{sessionId}.jsonl`. Each line is a JSON record — user messages, assistant responses (streamed as multiple chunks), tool calls, and tool results.

`inspecto` streams these files line-by-line (never loading 100MB+ files into memory), merges streaming chunks by `message.id`, extracts tool-use patterns and token usage, and computes the 7 metrics above.

The composite grade is a weighted average mapped to a letter grade from **A+** to **F**.

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
├── metrics/       # 7 pure-function quality metrics + composite grader
├── anomaly/       # Baseline computation + regression detection + cache anomaly
├── reporter/      # Terminal (chalk + cli-table3) and JSON output modes
├── commands/      # audit, trend, cache-check, compare
└── utils/         # Levenshtein, paths, duration parsing, formatting
```

Key technical details:
- **Streaming parse**: `readline` + `createReadStream` — never loads full files into memory
- **Chunk deduplication**: Assistant responses come as multiple JSONL records sharing `message.id`; content blocks are merged and only the final chunk's `output_tokens` is used
- **No external APIs**: All analysis is local. No network calls. Works offline
- **Real token cost**: `input_tokens` is always a streaming placeholder — actual input = `cache_read_input_tokens + cache_creation_input_tokens`

---

## License

MIT
