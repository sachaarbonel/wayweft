---
title: Getting Started
description: Install Wayweft, detect duplicate code in your TypeScript project, and set up codebase memory for AI coding sessions.
slug: docs/getting-started
---

## Install dependencies

From the repository root:

```bash
npm install
npm --prefix docs install
```

Build the CLI once:

```bash
npm run build
```

## First run

Scan a target workspace:

```bash
wayweft scan --cwd /path/to/project --scope workspace --format text
```

If you have not linked the package globally yet, run the built CLI directly:

```bash
node dist/cli.js scan --cwd /path/to/project --scope workspace --format text
```

Run a dry-run safe fix pass:

```bash
wayweft fix --cwd /path/to/project --dry-run
```

Inspect setup and discovery assumptions:

```bash
wayweft doctor --cwd /path/to/project
```

## AI coding agent cleanup workflow

Wayweft is designed to complement Claude, Codex, and other AI coding sessions:

- scan changed files or a monorepo package to detect duplicate code before large edits
- review findings for duplicate functions, complexity, and cross-package boundary issues
- apply safe TypeScript codemods with `--dry-run` first
- install the skill bundle to preserve codebase context for future agent sessions

## Docs workflow

Run the documentation site locally:

```bash
npm run docs:dev
```

Build a static bundle:

```bash
npm run docs:build
```

The generated site lives in `docs/dist` and can be self-hosted by serving that directory from any static host.
