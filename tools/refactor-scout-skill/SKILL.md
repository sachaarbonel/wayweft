---
name: refactor-scout
description: Analyze a TypeScript repo or monorepo for concrete refactoring opportunities, rank the findings, and optionally apply safe codemods. Use for code smell detection, monorepo hotspot analysis, complexity reduction, duplicate utility detection, and scoped cleanup work.
---

When invoked:

1. Determine the current scope from the working directory.
   - If inside a package, prefer package scope first.
   - If the user asks for broad analysis, use workspace scope.

2. Run:
   - `refactor-scout scan --format json --output .tmp/refactor-scout.json`
   - For quick review on large repos, use `--scope changed` when appropriate.

3. Read the report and group findings into:
   - safe quick wins
   - architectural hotspots
   - findings requiring human judgment

4. Prefer safe fixes first.
   - Only use fixes marked safe.
   - Use dry-run unless the user clearly asked for edits.

5. After any edits:
   - rerun the scan
   - run lint/tests for touched packages
   - summarize residual findings

Do not:
- apply broad cross-package refactors without review
- change public APIs silently
- touch generated files
- treat low-confidence findings as required work
