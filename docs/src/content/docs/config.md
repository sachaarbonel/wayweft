---
title: Configuration
description: Current config surface and practical expectations.
---

Wayweft is intentionally light on configuration in its current form.

## What exists today

- scope selection through CLI flags
- output format selection through CLI flags
- changed-scope scanning relative to a Git reference

## Important constraint

The current CLI operates on the current working directory. A dedicated `--cwd` flag is not implemented yet, so run the command from the target repository root.

## Near-term direction

As the tool grows, configuration should stay explicit and repo-local so agents and humans can reason about scan behavior without hidden defaults.
