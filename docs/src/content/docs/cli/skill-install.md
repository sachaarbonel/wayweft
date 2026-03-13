---
title: "CLI: skill install"
description: Install the portable codebase memory and review bundle for AI coding agent handoffs.
slug: docs/cli/skill-install
---

`wayweft skill install` writes a portable codebase memory bundle into a target repository so AI coding agents like Claude and Codex inherit the same scan, triage, and review workflow across sessions.

## Install into the current repo

```bash
wayweft skill install --cwd /path/to/project
```

If you are invoking the built CLI from this repo:

```bash
node /absolute/path/to/wayweft/dist/cli.js skill install --cwd /path/to/project
```

## Installed files

The command writes the bundle and guidance files used by supported agents, including the `tools/wayweft-skill` content and the repo-level guidance files.

## Recommended flow

- build or link the CLI
- run `skill install`
- commit the generated guidance so future sessions inherit the workflow
