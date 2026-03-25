---
title: "CLI: scan"
description: Detect duplicate code and code quality issues across a TypeScript workspace or monorepo package.
slug: docs/cli/scan
---

`wayweft scan` detects duplicate functions, structural drift, hotspot files, and code quality issues across your TypeScript workspace or monorepo packages.

When you use `--scope changed` or `--scope since:<ref>`, Wayweft also emits heuristic `test-impact-hint`, `blast-radius`, and `change-risk` findings for changed source files. These findings list likely nearby tests, downstream local-import impact, and advisory review risk when a changed file sits in a sensitive or widely imported path.

Workspace scans also prepend a deterministic triage layer to text, markdown, and JSON output. The triage payload groups findings into a small set of actionable themes and builds a start-here queue so the highest-value files are reviewed first. Changed-scope scans keep their existing review-oriented findings and do not receive the workspace triage section.

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

Text and Markdown reports now include top hotspot files and package rollups. Workspace scans also include a `Triage` section with grouped themes and a deterministic `Start here` queue. Near-duplicate findings are clustered into actionable families instead of pairwise spam, and hotspot entries surface deterministic seam hints when a likely extraction target is obvious. Hotspot scores combine deterministic local signals such as LOC, churn, complexity, coupling, and ownership spread so large files do not automatically dominate the ranking. JSON output includes the same workspace triage data under `triage.themes` and `triage.startHere`.
