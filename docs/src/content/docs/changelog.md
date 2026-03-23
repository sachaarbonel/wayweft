---
title: Changelog
description: Lightweight release notes for user-visible Wayweft changes.
slug: docs/changelog
---

This changelog is intentionally lightweight. Record user-visible features, fixes, docs changes, and workflow updates here when they land.

## 2026-03-23

### Added

- Added heuristic `test-impact-hint` findings for `changed` and `since` scans so touched source files can point to likely related tests or warn when no nearby test match is found.
- Added git-backed scan coverage for colocated and separate test directory conventions.
- Added `near-duplicate-function` detection for high-confidence renamed or lightly edited duplicate helpers within a package.
- Added graph-backed `blast-radius` findings for changed files with downstream local-import impact.
- Added advisory `change-risk` findings for changed files in sensitive or shared-module paths.
- Added multi-signal `hotspot-score` findings plus hotspot file and package summaries that combine LOC, churn, complexity, coupling, and ownership spread.

### Changed

- Tuned `long-function` so it applies context-aware thresholds for test files, script-like files, and JSX-heavy components instead of using the same line limit everywhere.
- Added scan coverage proving the relaxed thresholds reduce noise in common frontend and test-heavy repos while still flagging genuine long-function hotspots.
- Documented the new `long-function`, hotspot, blast-radius, and change-risk behavior in the README and scan reference.

## 2026-03-13 (b)

### Changed

- Updated site copy to target duplicate code detection, TypeScript monorepo maintenance, AI coding agent handoff, and codebase memory keywords across landing page, docs index, CLI references, and guides.
- Added roadmap entries for AST-based duplicate detection and CLAUDE.md / AGENTS.md codebase memory integration.

## 2026-03-13

### Fixed

- Added broader built-in ignore defaults for generated output and vendored assets, including `build`, `.next`, `vendor`, and `*.min.js`.
- Documented how to extend built-in ignore defaults with `defaultIgnorePatterns` or override them completely with `ignore: []`.
- Switched scan inventory discovery to a gitignore-style walker that respects root and nested `.gitignore` and `.ignore` files.

### Added

- Added scan coverage that proves generated and vendored files stay out of the default inventory unless a repo opts back in.
- Introduced a self-hosted Astro + Starlight documentation site under `docs/`.
- Added a branded landing page at `/` and moved the documentation to `/docs/`.
- Added starter documentation for setup, CLI usage, configuration, CI, roadmap, and branding direction.
- Added CLI `--cwd` support and basic `--help` output for the primary commands.
- Added a dedicated `doctor` CLI reference page with sample setup-debugging output.

### Changed

- Added project guidance requiring documentation updates alongside feature and fix work.
- Expanded `wayweft doctor` to report config resolution, package and tsconfig discovery, active ignore patterns, and skill bundle installation status.
