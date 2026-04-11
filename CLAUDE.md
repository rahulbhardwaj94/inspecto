# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # Compile TypeScript → dist/ via tsup (ESM, Node 18 target)
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

cc-audit grades Claude Code sessions by streaming their local JSONL logs and computing 7 quality metrics — no external API calls, no telemetry.

**Data source:** `~/.claude/projects/{projectSlug}/{sessionId}.jsonl`

### Pipeline (linear, no cycles)

```
JSONL file (streaming)
  → readJsonl()          [src/parser/jsonl-reader.ts]   — AsyncGenerator, never loads full file
  → buildSession()       [src/parser/session-builder.ts] — merges streaming chunks by message.id
  → gradeSession()       [src/metrics/grader.ts]        — runs all 7 metrics, computes weighted score
  → render*Report()      [src/reporter/terminal.ts]     — chalk + cli-table3 output
```

### Key implementation details

**Chunk merging:** Claude streams assistant responses as multiple JSONL records sharing a `message.id`. Only the final chunk (where `stop_reason != null`) carries real `output_tokens`. `session-builder.ts` must accumulate text across chunks but take token counts only from the final chunk.

**Token cost accuracy:** `input_tokens` in raw JSONL is a streaming placeholder and must not be used directly. Real input cost = `cache_read_input_tokens + cache_creation_input_tokens`.

**Project discovery:** `src/parser/project-scanner.ts` walks `~/.claude/projects/` and returns session files sorted by mtime. The `--data-dir` flag overrides the default Claude data directory.

### The 7 Metrics (`src/metrics/`)

| File | Metric | Healthy |
|------|--------|---------|
| `reads-per-edit.ts` | Read tool calls before each Write/Edit | ≥ 4.0 |
| `rewrite-ratio.ts` | Writes / (Writes + Edits) | ≤ 0.25 |
| `cache-hit-rate.ts` | cache_read / (cache_read + cache_creation) tokens | ≥ 0.50 |
| `task-completion.ts` | 1 − (unfulfilled intents / total intents) | ≥ 0.90 |
| `retry-density.ts` | Similar consecutive user messages (Levenshtein > 0.6) / pairs | ≤ 0.10 |
| `tool-diversity.ts` | Shannon entropy of tool distribution, normalized 0–1 | ≥ 0.60 |
| `tokens-per-edit.ts` | Total output tokens / file modification count | ≤ 5,000 |

All metrics are pure functions of a `Session` object. To add a new metric: implement it in `src/metrics/`, register it in `grader.ts` with a weight (all weights must sum to 1.0).

**Grader weights:** reads-per-edit 20%, rewrite-ratio 15%, cache-hit-rate 15%, task-completion 15%, tokens-per-edit 15%, retry-density 10%, tool-diversity 10%.

### Module responsibilities

- **`src/commands/`** — CLI command handlers (`audit`, `trend`, `cache-check`, `compare`). Each orchestrates: scan → parse → grade → report.
- **`src/anomaly/`** — Multi-session analysis: `baseline.ts` computes rolling averages, `regression-detector.ts` flags >30% degradation, `cache-anomaly.ts` flags sessions with <5% cache hit rate.
- **`src/reporter/`** — Terminal rendering (`terminal.ts`) and structured JSON output (`json-reporter.ts`). `tips.ts` maps metric statuses to context-sensitive improvement messages.
- **`src/utils/`** — `paths.ts` (cross-platform `~/.claude` resolution), `duration.ts` (parses `7d`/`14d`/`30d`), `levenshtein.ts` (retry detection), `format.ts` (display helpers).

### Build output

tsup bundles `src/index.ts` to `dist/index.js` as a single ESM file with a `#!/usr/bin/env node` shebang injected, making it directly executable. `npm run lint` (tsc) and `npm run build` (tsup) are separate steps — passing one does not guarantee the other.
