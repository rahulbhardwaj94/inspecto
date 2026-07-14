# Privacy

Inspecto is a local command-line tool. Its analysis code does not send session data, prompts, source code, tool inputs/results, computed metrics, or identifiers to Rahul Bhardwaj or to an Inspecto-operated service.

## Data Inspecto reads

Inspecto reads Claude Code JSONL session files from the configured local data directory (normally `~/.claude/projects/`). Those files can contain sensitive prompts, source-code fragments, file paths, tool inputs/results, and other project context.

Inspecto also maintains a local grade cache at `~/.claude/inspecto-cache.db`. The cache contains computed grade results keyed by a hash of the local file path and modification time. Use `inspecto cache clear` to delete it.

## Metrics-only export

`inspecto export` is designed for a privacy-minimized team baseline. It outputs computed per-session metrics with generated session, period, and project labels. It excludes:

- prompts and assistant text
- source code
- tool inputs and results
- local paths and working directories
- git branches
- user names
- raw session and project identifiers

The export does include the recorded model, grade, score, and computed metric values. Review any export before sharing it. Once you redirect output to a file or share it with another party, that copy is governed by your own storage, retention, access, and vendor policies.

## Network behavior

Inspecto's runtime has no analytics or telemetry endpoint and needs no API key. Installing through npm and following links in the documentation involve third-party services governed by their own policies.

## Team use

Do not use Inspecto as covert employee surveillance. Tell participants what will be analyzed, aggregate results by default, collect the minimum data needed, restrict access, set a deletion date, and follow applicable employment and privacy law.

## Contact

For privacy questions, open a GitHub issue that does not contain session data, prompts, code, credentials, or other sensitive information.
