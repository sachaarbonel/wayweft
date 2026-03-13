# refactor-scout
A TypeScript-first, AST-based refactoring opportunity engine for single-package repos and monorepos, with CLI, CI, JSON/SARIF output, codemod support, and agent-facing integrations for Codex and Claude

## Status

This repository now includes:

- a TypeScript CLI and programmatic API
- workspace and monorepo discovery
- AST-based analysis with `ts-morph`
- text, JSON, Markdown, and SARIF reporting
- safe codemod scaffolding with dry-run/apply flow
- portable skill bundles for Codex and Claude
- root guidance templates for `AGENTS.md` and `CLAUDE.md`

## Commands

```bash
npm install
npm run build
npm run test

refactor-scout scan --scope workspace --format text
refactor-scout scan --scope package:<name> --format json --output .tmp/refactor-scout.json
refactor-scout fix --dry-run
refactor-scout skill install
refactor-scout doctor
```

## Run locally on a project

Build the tool once from this repository:

```bash
npm install
npm run build
```

Then scan a target project by changing into that project directory and invoking the built CLI:

```bash
cd /path/to/project
node /absolute/path/to/refactor-scout/dist/cli.js scan --scope workspace --format text
node /absolute/path/to/refactor-scout/dist/cli.js scan --scope package:web --format json --output .tmp/refactor-scout.json
node /absolute/path/to/refactor-scout/dist/cli.js fix --dry-run
```

If you want `refactor-scout` available as a normal shell command, link it globally from this repo:

```bash
npm link
```

Then use it inside any project:

```bash
cd /path/to/project
refactor-scout scan --scope workspace --format text
refactor-scout skill install
refactor-scout doctor
```

## Install the skill in a target repo

From the target repository root, install the skill bundle with the built CLI:

```bash
cd /path/to/project
node /absolute/path/to/refactor-scout/dist/cli.js skill install
```

If you already linked the package globally with `npm link`, use:

```bash
cd /path/to/project
refactor-scout skill install
```

This writes the portable skill bundle and guidance files into the target repo, including:

- `tools/refactor-scout-skill`
- `.agents/skills/refactor-scout`
- `.claude/skills/refactor-scout`
- `AGENTS.md`
- `CLAUDE.md`

For monorepos, it also writes package-local copies under each discovered workspace package.

Note: the current CLI uses the current working directory as the scan target. A dedicated `--cwd` flag is not implemented yet.

## Implemented v1 rules

- `long-function`
- `deep-nesting`
- `too-many-params`
- `boolean-param`
- `cross-package-duplication`
- `import-cycle`
- `boundary-violation`
- safe rewrite opportunities for direct boolean returns, nullish coalescing, and optional chaining
