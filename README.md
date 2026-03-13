# Wayweft

Wayweft is a codebase intelligence layer for AI-assisted development. It helps teams review changes after a Claude or Codex session, detect duplication and refactor drift, preserve codebase context, and carry knowledge forward across sessions.

Today, Wayweft includes a TypeScript-first CLI for changed-scope review, refactoring opportunity detection, safe cleanup workflows, and agent-facing skill bundles for Codex and Claude.

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

wayweft scan --scope workspace --format text
wayweft scan --scope package:<name> --format json --output .tmp/wayweft.json
wayweft fix --dry-run
wayweft skill install
wayweft doctor
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
node /absolute/path/to/wayweft/dist/cli.js scan --scope workspace --format text
node /absolute/path/to/wayweft/dist/cli.js scan --scope package:web --format json --output .tmp/wayweft.json
node /absolute/path/to/wayweft/dist/cli.js fix --dry-run
```

If you want `wayweft` available as a normal shell command, link it globally from this repo:

```bash
npm link
```

Then use it inside any project:

```bash
cd /path/to/project
wayweft scan --scope workspace --format text
wayweft skill install
wayweft doctor
```

## Install the skill in a target repo

From the target repository root, install the skill bundle with the built CLI:

```bash
cd /path/to/project
node /absolute/path/to/wayweft/dist/cli.js skill install
```

If you already linked the package globally with `npm link`, use:

```bash
cd /path/to/project
wayweft skill install
```

This writes the portable skill bundle and guidance files into the target repo, including:

- `tools/wayweft-skill`
- `.agents/skills/wayweft`
- `.claude/skills/wayweft`
- `AGENTS.md`
- `CLAUDE.md`

For monorepos, it also writes package-local copies under each discovered workspace package.

Note: the current CLI uses the current working directory as the scan target. A dedicated `--cwd` flag is not implemented yet.

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
- `import-cycle`
- `boundary-violation`
- safe rewrite opportunities for direct boolean returns, nullish coalescing, and optional chaining
