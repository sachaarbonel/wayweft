---
title: "CLI: skill install"
description: Install the portable Wayweft skill bundle into a target repository.
---

`wayweft skill install` writes the portable guidance bundle into a target repository so agents can reuse the same scan and triage workflow.

## Install into the current repo

```bash
wayweft skill install
```

If you are invoking the built CLI from this repo:

```bash
node /absolute/path/to/wayweft/dist/cli.js skill install
```

## Installed files

The command writes the bundle and guidance files used by supported agents, including the `tools/wayweft-skill` content and the repo-level guidance files.

## Recommended flow

- build or link the CLI
- change into the target repository
- run `skill install`
- commit the generated guidance so future sessions inherit the workflow
