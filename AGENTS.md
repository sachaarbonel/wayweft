# AGENTS.md

## Build and test
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

## Refactor Scout workflow
- Workspace scan: `refactor-scout scan --scope workspace --format text`
- Package scan: `refactor-scout scan --scope package:<name> --format json`
- Changed scope scan: `refactor-scout scan --scope changed --since origin/main --format sarif`
- Safe fixes: `refactor-scout fix --dry-run`

## Guidance
- Prefer package-local scans when working inside a monorepo package.
- Never apply wide refactors without review.
- Run lint/tests for touched packages only after fixes.
- Do not modify generated files, fixtures, migrations, coverage, or dist output.
