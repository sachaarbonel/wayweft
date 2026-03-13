---
title: "CLI: scan"
description: Analyze a workspace or package scope and emit actionable findings.
---

`wayweft scan` inspects the selected scope and reports refactor opportunities, structural risks, and rule matches.

## Common examples

```bash
wayweft scan --scope workspace --format text
wayweft scan --scope package:web --format json --output .tmp/wayweft.json
wayweft scan --scope changed --since origin/main --format sarif
```

## When to use it

- Before a broad refactor to estimate risk
- After an agent session to review drift in touched areas
- In CI when you want machine-readable output such as SARIF

## Output formats

- `text` for local review
- `json` for tooling integration
- `markdown` for human-readable reports
- `sarif` for code scanning pipelines
