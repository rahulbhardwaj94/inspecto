# Security policy

## Supported version

Security fixes are applied to the latest published release.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's security-advisory flow for this repository when available. Do not attach real Claude Code session files, prompts, source code, credentials, access tokens, or personal data. A minimal synthetic reproduction is preferred.

## Sensitive local data

Claude Code session logs may contain secrets and proprietary code. Before running Inspecto on a shared machine:

- restrict filesystem access to the Claude data directory and Inspecto cache;
- never commit raw session logs or metrics exports;
- review redacted exports before transmitting them;
- clear the local grade cache when retention is no longer needed;
- rotate any credential that appears in a session log.

Inspecto's diagnostic output is not a security audit and does not determine whether generated code is safe.
