---
title: "CLI: fix"
description: Preview or apply safe cleanup rewrites.
slug: docs/cli/fix
---

`wayweft fix` is the low-risk rewrite companion to `scan`.

## Safe first step

Preview the planned edits:

```bash
wayweft fix --dry-run
```

This keeps the workflow reviewable before touching files.

## Intended use

Use `fix` for mechanical cleanup opportunities such as direct boolean returns, nullish coalescing, and optional chaining where the tool can preserve behavior with high confidence.

## Suggested workflow

1. Run `scan` to understand the scope.
2. Run `fix --dry-run` to preview changes.
3. Review the diff.
4. Apply fixes only where the resulting patch is clearly safe for the target repo.
