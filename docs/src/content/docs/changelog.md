---
title: Changelog
description: Lightweight release notes for user-visible Wayweft changes.
slug: docs/changelog
---

This changelog is intentionally lightweight. Record user-visible features, fixes, docs changes, and workflow updates here when they land.

## 2026-03-13 (b)

### Changed

- Updated site copy to target duplicate code detection, TypeScript monorepo maintenance, AI coding agent handoff, and codebase memory keywords across landing page, docs index, CLI references, and guides.
- Added roadmap entries for AST-based duplicate detection and CLAUDE.md / AGENTS.md codebase memory integration.

## 2026-03-13

### Added

- Introduced a self-hosted Astro + Starlight documentation site under `docs/`.
- Added a branded landing page at `/` and moved the documentation to `/docs/`.
- Added starter documentation for setup, CLI usage, configuration, CI, roadmap, and branding direction.
- Added CLI `--cwd` support and basic `--help` output for the primary commands.
- Added a dedicated `doctor` CLI reference page with sample setup-debugging output.

### Changed

- Added project guidance requiring documentation updates alongside feature and fix work.
- Expanded `wayweft doctor` to report config resolution, package and tsconfig discovery, active ignore patterns, and skill bundle installation status.
