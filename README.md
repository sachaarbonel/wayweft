# Wayweft

Wayweft is a codebase intelligence layer for AI-assisted development. It helps teams review changes after a Claude or Codex session, detect duplication and refactor drift, preserve codebase context, and carry knowledge forward across sessions.

Today, Wayweft includes a TypeScript-first CLI for changed-scope review, refactoring opportunity detection, safe cleanup workflows, and agent-facing skill bundles for Codex and Claude.

Changed-scope scans now also add heuristic test impact hints, graph-backed blast-radius hints, and advisory change-risk signals, so touched source files can surface likely nearby tests, downstream impact, and shared-module risk without depending on external services.

Workspace scans now add a deterministic triage layer, cluster near-duplicate helpers into actionable families, and attach hotspot seam hints so large repo reports start with a shorter, more useful refactor queue.

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

wayweft --help
wayweft scan --cwd /path/to/repo --scope workspace --format text
wayweft scan --cwd /path/to/repo --scope package:<name> --format json --output .tmp/wayweft.json
wayweft fix --cwd /path/to/repo --dry-run
wayweft skill install --cwd /path/to/repo
wayweft doctor --cwd /path/to/repo
```

## Run locally on a project

Build the tool once from this repository:

```bash
npm install
npm run build
```

Then scan a target project from any working directory by pointing the CLI at the repo:

```bash
node /absolute/path/to/wayweft/dist/cli.js --help
node /absolute/path/to/wayweft/dist/cli.js scan --cwd /path/to/project --scope workspace --format text
node /absolute/path/to/wayweft/dist/cli.js scan --cwd /path/to/project --scope package:web --format json --output .tmp/wayweft.json
node /absolute/path/to/wayweft/dist/cli.js fix --cwd /path/to/project --dry-run
```

If you want `wayweft` available as a normal shell command, link it globally from this repo:

```bash
npm link
```

Then use it from anywhere:

```bash
wayweft scan --cwd /path/to/project --scope workspace --format text
wayweft skill install --cwd /path/to/project
wayweft doctor --cwd /path/to/project
```

`doctor` is intended as a setup-debugging command. A typical run shows the resolved workspace root, config status, discovery assumptions, active ignore patterns, and skill bundle installation state:

```text
Workspace root: /path/to/project
Config: /path/to/project/wayweft.config.ts
Discovery markers: pnpm-workspace.yaml, turbo.json, nx.json, rush.json, package.json, .git
Package globs: apps/*, packages/*, services/*, libs/*
Packages discovered: 3
  - root (., tsconfig)
  - web (apps/web, tsconfig)
  - shared (packages/shared, no tsconfig)
Tsconfig files: 2
Files in scan inventory: 84
Ignore patterns (from config):
  - **/dist/**
  - **/build/**
  - **/coverage/**
  - **/*.min.js**
Skill bundles:
  - root bundle files: 3/3 installed
  - package-local bundles: 2/3 packages
Doctor checks: ok
```

## Install the skill in a target repo

Install the skill bundle into a target repository with the built CLI:

```bash
node /absolute/path/to/wayweft/dist/cli.js skill install --cwd /path/to/project
```

If you already linked the package globally with `npm link`, use:

```bash
wayweft skill install --cwd /path/to/project
```

This writes the portable skill bundle and guidance files into the target repo, including:

- `tools/wayweft-skill`
- `.agents/skills/wayweft`
- `.claude/skills/wayweft`
- `AGENTS.md`
- `CLAUDE.md`

For monorepos, it also writes package-local copies under each discovered workspace package.

## Default ignore behavior

Wayweft skips obvious generated and vendored files by default so scans stay focused on code you would realistically review or refactor by hand. The built-in patterns cover:

- generated output folders such as `dist`, `build`, and `.next`
- coverage reports and Jest snapshots
- generated source files matching `*.generated.*`
- vendored assets such as `vendor/`, `vendors/`, and `*.min.js`
- dependency and support directories such as `node_modules`, `fixtures`, and `migrations`

Wayweft also respects repo ignore files during traversal:

- root and nested `.gitignore`
- root and nested `.ignore`

You can override the defaults completely with `ignore: []` in `wayweft.config.*`, or extend them in TypeScript config files:

```ts
import { defaultIgnorePatterns, defineConfig } from "wayweft";

export default defineConfig({
  ignore: [...defaultIgnorePatterns, "**/custom-generated/**"],
});
```

## Documentation site

This repo includes a minimal self-hosted docs site built with Astro + Starlight in [`docs/`](/Users/pratimbhosale/.codex/worktrees/0ac1/refactor-scout/docs).

Install dependencies for both apps:

```bash
npm install
npm --prefix docs install
```

Run the docs locally:

```bash
npm run docs:dev
```

Build the static site:

```bash
npm run docs:build
```

Preview the built output:

```bash
npm run docs:preview
```

The generated static files are written to `docs/dist`. Self-hosting is just serving that directory from any static file host or web server.

## Implemented v1 rules

- `long-function`
- `deep-nesting`
- `too-many-params`
- `boolean-param`
- `cross-package-duplication`
- `near-duplicate-function`
- workspace triage summaries with grouped themes and a deterministic start-here queue
- `import-cycle`
- `boundary-violation`
- safe rewrite opportunities for direct boolean returns, nullish coalescing, and optional chaining
- `test-impact-hint` for changed source files with likely related tests or missing nearby-test matches
- `blast-radius` for changed files with downstream local-import impact
- `change-risk` for changed files in sensitive or widely imported paths
- `hotspot-score` for multi-signal hotspot ranking across files and package rollups

`long-function` is context-aware by default. It keeps the base threshold for ordinary source files, but relaxes it for test files, script-like files, and JSX-heavy component files so common repo shapes do not dominate the report with low-value noise.

`test-impact-hint` only runs for `changed` and `since` scans. It uses common TypeScript naming and directory conventions such as `src/`, `test/`, `tests/`, and `__tests__/` to suggest related tests. The output is intentionally advisory and does not claim to prove coverage.

`near-duplicate-function` clusters related matches into one family finding instead of emitting one finding per pair. Test/setup helpers and tiny bodies are filtered more aggressively by default so the highest-value production duplication stays visible near the top.

Workspace scans include a triage section in text, markdown, and JSON output. It groups findings into a few actionable themes and builds a deterministic start-here queue for large repos. Changed-scope scans stay on the existing review-oriented path and do not emit workspace triage.

`hotspot-score` combines deterministic local signals such as LOC, churn, static complexity, coupling, and git author spread. LOC is treated as a weak signal, so a smaller but shared, complex, high-churn module can outrank a large stable file. When local structure makes the next cut obvious, hotspot results also include seam hints such as oversized exports, helper groups, or route clusters.
