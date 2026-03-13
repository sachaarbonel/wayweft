---
name: refactor-scout
description: Analyze a TypeScript repo or monorepo for concrete refactoring opportunities, rank the findings, and optionally apply safe codemods. Use for code smell detection, monorepo hotspot analysis, complexity reduction, duplicate utility detection, and scoped cleanup work.
---

When invoked:

1. Use this as a post-session cleanup pass after Codex or Claude makes code changes.
   - Start by scanning the agent's own changes before finalizing.
   - Prefer changed scope first, then widen to package or workspace scope if the findings suggest broader duplication or architectural drift.

2. Determine the current scope from the working directory.
   - If inside a package, prefer package scope first.
   - If the session touched multiple packages or shared infrastructure, widen to workspace scope.

3. Run:
   - `refactor-scout scan --scope changed --since origin/main --format json --output .tmp/refactor-scout.json`
   - If changed scope is too narrow for the task, rerun with `--scope package:<name>` or `--scope workspace`.

4. Read the report and prioritize:
   - duplicated helpers or utilities introduced during the session
   - repeated query, route, or data-shaping logic
   - repeated UI/state patterns that should become shared hooks or components
   - oversized new functions, boolean flag APIs, and parameter-heavy helpers

5. Group findings into:
   - safe quick wins
   - architectural hotspots
   - findings requiring human judgment

6. Prefer safe fixes first.
   - Only use fixes marked safe.
   - Use dry-run unless the user clearly asked for edits.

7. After any edits:
   - rerun the scan
   - run lint/tests for touched packages
   - summarize residual findings

Do not:
- apply broad cross-package refactors without review
- change public APIs silently
- touch generated files
- treat low-confidence findings as required work
