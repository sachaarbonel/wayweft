---
title: "CLI: fix"
description: Preview or apply safe TypeScript codemods and cleanup rewrites.
slug: docs/cli/fix
---

`wayweft fix` applies safe TypeScript codemods — the low-risk rewrite companion to `scan`.

## Safe first step

Preview the planned edits:

```bash
wayweft fix --cwd /path/to/repo --dry-run
```

This keeps the workflow reviewable before touching files.

## Intended use

Use `fix` for safe, automated TypeScript refactoring: direct boolean returns, nullish coalescing, and optional chaining. These are the mechanical codemods where the tool can preserve behavior with high confidence — ideal for cleaning up after AI coding sessions.

## Suggested workflow

1. Run `scan` to understand the scope.
2. Run `fix --dry-run` to preview changes.
3. Review the diff.
4. Apply fixes only where the resulting patch is clearly safe for the target repo.
