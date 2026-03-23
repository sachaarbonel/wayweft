---
title: "CLI: scan"
description: Detect duplicate code and code quality issues across a TypeScript workspace or monorepo package.
slug: docs/cli/scan
---

`wayweft scan` detects duplicate functions, structural drift, and code quality issues across your TypeScript workspace or monorepo packages.

When you use `--scope changed` or `--scope since:<ref>`, Wayweft also emits heuristic `test-impact-hint` findings for changed source files. These findings list likely nearby tests when path and naming conventions match, or warn when no obvious test file is found.

## Common examples

```bash
wayweft scan --cwd /path/to/repo --scope workspace --format text
wayweft scan --cwd /path/to/repo --scope package:web --format json --output .tmp/wayweft.json
wayweft scan --cwd /path/to/repo --scope changed --since origin/main --format sarif
```

## When to use it

- Before a broad refactor to detect duplicate code and estimate risk
- After a Claude or Codex session to review drift and duplicate helpers in touched areas
- After editing source files on a branch to see which nearby tests are likely relevant before review
- In CI to catch cross-package duplication and emit SARIF for code scanning pipelines

## Output formats

- `text` for local review
- `json` for tooling integration
- `markdown` for human-readable reports
- `sarif` for code scanning pipelines
