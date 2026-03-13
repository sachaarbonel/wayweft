# AGENTS.md

## Build and test
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

## Wayweft workflow
- Workspace scan: `wayweft scan --scope workspace --format text`
- Package scan: `wayweft scan --scope package:<name> --format json`
- Changed scope scan: `wayweft scan --scope changed --since origin/main --format sarif`
- Safe fixes: `wayweft fix --dry-run`

## Guidance
- Prefer package-local scans when working inside a monorepo package.
- Never apply wide refactors without review.
- Run lint/tests for touched packages only after fixes.
- Do not modify generated files, fixtures, migrations, coverage, or dist output.
- Treat documentation as part of the feature or fix. When behavior, commands, workflow, output, configuration, or positioning changes, update the relevant docs in `README.md` and `docs/` in the same change.
- For user-visible features, fixes, or workflow changes, add or update an entry in `docs/src/content/docs/changelog.md`.
- If a code change does not require doc updates, state that explicitly in the final summary instead of silently skipping docs.
