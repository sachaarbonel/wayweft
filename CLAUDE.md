# CLAUDE.md

## Workspace structure
- The tool supports single-package repos and monorepos.
- Prefer package-local scans when working inside `apps/*`, `packages/*`, `services/*`, or `libs/*`.
- Treat internal package boundaries as first-class analysis signals.

## Validation
- Run `wayweft scan` before and after code changes.
- Apply only safe fixes by default.
- Validate touched packages with local lint/tests after edits.
- When a feature, fix, command surface, workflow, configuration detail, or docs-visible behavior changes, update `README.md` and the matching page under `docs/src/content/docs/` in the same task.
- Add or refresh a dated note in `docs/src/content/docs/changelog.md` for user-visible changes so the docs retain a lightweight release history.

## Guardrails
- Generated files, fixtures, migrations, and build outputs are read-only.
- Do not apply broad cross-package refactors without review.
- Escalate low-confidence architectural findings instead of auto-editing them.
- Do not update the portable CLI-installed skill bundle instructions for this rule unless explicitly asked; keep this policy scoped to the project guidance files.
