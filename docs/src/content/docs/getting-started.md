---
title: Getting Started
description: Install Wayweft, run a first scan, and build the docs site locally.
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

Scan the current workspace:

```bash
wayweft scan --scope workspace --format text
```

If you have not linked the package globally yet, run the built CLI directly:

```bash
node dist/cli.js scan --scope workspace --format text
```

Run a dry-run safe fix pass:

```bash
wayweft fix --dry-run
```

## Agent workflow basics

Wayweft is designed to complement agent sessions:

- scan the changed area or package before large edits
- review the findings for duplication, complexity, and boundary issues
- apply low-risk fixes with `--dry-run` first
- install the skill bundle into target repos for repeatable guidance

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
