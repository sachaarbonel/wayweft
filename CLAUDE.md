# CLAUDE.md

## Workspace structure
- The tool supports single-package repos and monorepos.
- Prefer package-local scans when working inside `apps/*`, `packages/*`, `services/*`, or `libs/*`.
- Treat internal package boundaries as first-class analysis signals.

## Validation
- Run `refactor-scout scan` before and after code changes.
- Apply only safe fixes by default.
- Validate touched packages with local lint/tests after edits.

## Guardrails
- Generated files, fixtures, migrations, and build outputs are read-only.
- Do not apply broad cross-package refactors without review.
- Escalate low-confidence architectural findings instead of auto-editing them.
