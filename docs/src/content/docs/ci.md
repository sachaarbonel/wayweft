---
title: CI
description: Use Wayweft in automation without adding deployment complexity.
---

Wayweft already supports output formats that fit CI pipelines well.

## Suggested CI uses

- run changed-scope scans on pull requests
- publish SARIF output to code scanning tools
- capture JSON or Markdown artifacts for review workflows

## Example

```bash
wayweft scan --scope changed --since origin/main --format sarif
```

## Docs hosting

The docs app is fully static. Build it with:

```bash
npm run docs:build
```

Then serve `docs/dist` from any static hosting platform or your own web server.
