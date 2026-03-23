---
title: Configuration
description: Current config surface and practical expectations.
slug: docs/config
---

Wayweft is intentionally light on configuration in its current form.

## What exists today

- scope selection through CLI flags
- output format selection through CLI flags
- changed-scope scanning relative to a Git reference
- repo-local ignore patterns for generated and vendored files

## Current CLI behavior

Most commands can target another repository directly with `--cwd`, so you do not need to change directories before running a scan, fix, doctor check, or skill install.

## Default ignore categories

Built-in defaults keep obvious scan noise out of the file inventory:

- generated output such as `dist`, `build`, and `.next`
- coverage reports and `__snapshots__`
- generated source files matching `*.generated.*`
- vendored assets such as `vendor/`, `vendors/`, and `*.min.js`

Wayweft also reads root and nested `.gitignore` and `.ignore` files while it walks the workspace, so repo-local ignore rules prune the scan inventory before analysis runs.

## Extending or overriding ignores

Use repo-local config when you want to scan something Wayweft would normally skip or when your repo has extra generated paths:

```ts
import { defaultIgnorePatterns, defineConfig } from "wayweft";

export default defineConfig({
  ignore: [...defaultIgnorePatterns, "**/custom-generated/**"],
});
```

If you need to opt back in completely, replace the defaults:

```ts
import { defineConfig } from "wayweft";

export default defineConfig({
  ignore: [],
});
```

## Context-aware long-function tuning

Wayweft keeps `long-function` opinionated, but it now adjusts the effective threshold by file context before raising a finding:

- ordinary source files use the configured `maxLines` value directly
- test files get an extra 20 lines of headroom
- script-like files under paths such as `scripts/`, `tools/`, or `bin/` get an extra 15 lines
- JSX-heavy `.tsx` and `.jsx` files get an extra 10 lines when they contain substantial JSX structure

The base config surface does not change. If you set `rules["long-function"].maxLines`, these context bonuses are applied on top so the report stays readable on frontend and test-heavy repos without hiding true hotspots.

## Near-term direction

As the tool grows, configuration should stay explicit and repo-local so agents and humans can reason about scan behavior without hidden defaults.
