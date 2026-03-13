import path from "node:path";
import { ensureDir, writeText } from "../utils/fs.js";

const skillReadme = `---
name: refactor-scout
description: Analyze a TypeScript repo or monorepo for concrete refactoring opportunities, rank the findings, and optionally apply safe codemods. Use for code smell detection, monorepo hotspot analysis, complexity reduction, duplicate utility detection, and scoped cleanup work.
---

When invoked:

1. Use this as a post-session cleanup pass after Codex or Claude makes code changes.
   - Start by scanning the agent's own changes before finalizing.
   - Prefer changed scope first, then widen to package or workspace scope if the findings suggest broader duplication or architectural drift.

2. Determine the current scope from the working directory.
   - If inside a package, prefer package scope first.
   - If the session touched multiple packages or shared infrastructure, widen to workspace scope.

3. Run:
   - \`refactor-scout scan --scope changed --since origin/main --format json --output .tmp/refactor-scout.json\`
   - If changed scope is too narrow for the task, rerun with \`--scope package:<name>\` or \`--scope workspace\`.

4. Read the report and prioritize:
   - duplicated helpers or utilities introduced during the session
   - repeated query, route, or data-shaping logic
   - repeated UI/state patterns that should become shared hooks or components
   - oversized new functions, boolean flag APIs, and parameter-heavy helpers

5. Group findings into:
   - safe quick wins
   - architectural hotspots
   - findings requiring human judgment

6. Prefer safe fixes first.
   - Only use fixes marked safe.
   - Use dry-run unless the user clearly asked for edits.

7. After any edits:
   - rerun the scan
   - run lint/tests for touched packages
   - summarize residual findings

Do not:
- apply broad cross-package refactors without review
- change public APIs silently
- touch generated files
- treat low-confidence findings as required work
`;

const usageReference = `# Usage

- Workspace scan: \`refactor-scout scan --scope workspace --format text\`
- Package scan: \`refactor-scout scan --scope package:<name> --format markdown\`
- Changed files: \`refactor-scout scan --scope changed --since origin/main --format json\`
- Safe fixes: \`refactor-scout fix --rule boolean-param --dry-run\`
- Post-session cleanup: \`refactor-scout scan --scope changed --since origin/main --format json --output .tmp/refactor-scout.json\`
`;

const triageReference = `# Triage

- Safe quick wins: findings with \`fix.safe === true\`
- Architectural hotspots: \`architecture\` findings with score >= 70
- Human review required: low-confidence or public API touching changes
`;

const runScanScript = `#!/usr/bin/env bash
set -euo pipefail

refactor-scout scan --format json --output .tmp/refactor-scout.json "$@"
`;

const runFixScript = `#!/usr/bin/env bash
set -euo pipefail

refactor-scout fix --dry-run "$@"
`;

const codexMetadata = `name: refactor-scout
description: Analyze and safely refactor TypeScript codebases with package-aware scope handling.
`;

export interface InstallSkillsOptions {
  rootDir: string;
  packageDirs?: string[];
}

export function installSkillBundles(options: InstallSkillsOptions): string[] {
  const written: string[] = [];
  const canonicalDir = path.join(options.rootDir, "tools", "refactor-scout-skill");
  writeSkillBundle(canonicalDir, false);
  written.push(canonicalDir);

  const codexDir = path.join(options.rootDir, ".agents", "skills", "refactor-scout");
  writeSkillBundle(codexDir, true);
  writeText(path.join(codexDir, "agents", "openai.yaml"), codexMetadata);
  written.push(codexDir);

  const claudeDir = path.join(options.rootDir, ".claude", "skills", "refactor-scout");
  writeSkillBundle(claudeDir, false);
  written.push(claudeDir);

  for (const packageDir of options.packageDirs ?? []) {
    const packageCodexDir = path.join(packageDir, ".agents", "skills", "refactor-scout");
    const packageClaudeDir = path.join(packageDir, ".claude", "skills", "refactor-scout");
    writeSkillBundle(packageCodexDir, false);
    writeSkillBundle(packageClaudeDir, false);
    written.push(packageCodexDir, packageClaudeDir);
  }

  writeRootGuidance(options.rootDir);
  written.push(path.join(options.rootDir, "AGENTS.md"), path.join(options.rootDir, "CLAUDE.md"));
  return written;
}

function writeSkillBundle(dir: string, includeMetadataDir: boolean): void {
  ensureDir(dir);
  writeText(path.join(dir, "SKILL.md"), skillReadme);
  writeText(path.join(dir, "references", "usage.md"), usageReference);
  writeText(path.join(dir, "references", "triage.md"), triageReference);
  writeText(path.join(dir, "scripts", "run-scan.sh"), runScanScript);
  writeText(path.join(dir, "scripts", "run-fix.sh"), runFixScript);
  if (includeMetadataDir) {
    ensureDir(path.join(dir, "agents"));
  }
}

function writeRootGuidance(rootDir: string): void {
  writeText(
    path.join(rootDir, "AGENTS.md"),
    `# AGENTS.md

## Refactor Scout workflow
- Build: \`npm run build\`
- Test: \`npm run test\`
- After a Codex or Claude coding session, run a changed-scope scan before finalizing.
- Post-session scan: \`refactor-scout scan --scope changed --since origin/main --format text\`
- Workspace scan: \`refactor-scout scan --scope workspace --format text\`
- Package scan: \`refactor-scout scan --scope package:<name> --format text\`
- Safe fixes: \`refactor-scout fix --dry-run\`

## Guidance
- Use Refactor Scout to catch duplicate helpers, repeated route/query logic, and parallel UI state flows introduced during the session.
- Prefer package-local scans when working inside a monorepo package.
- Never apply wide refactors without review.
- Run lint/tests for touched packages only.
- Generated files, dist output, coverage, fixtures, and migrations should stay untouched.
`,
  );

  writeText(
    path.join(rootDir, "CLAUDE.md"),
    `# CLAUDE.md

## Workspace structure
- Use package-local scans when inside \`apps/*\`, \`packages/*\`, or \`services/*\`.
- Respect workspace package ownership and internal boundaries.

## Validation
- After a Claude or Codex coding session, run \`refactor-scout scan --scope changed --since origin/main\` before finalizing.
- Widen to package or workspace scope if the changed-scope report suggests duplication outside the edited files.
- Validate with package-local lint and tests after safe fixes.
- Treat generated files and migrations as read-only.

## Preferred workflow
- Start with changed-scope findings on the session's edits.
- Look specifically for duplicate utilities, repeated state machines, repeated data shaping, and oversized new functions.
- Apply only safe fixes by default.
- Escalate architecture findings for review before broad changes.
`,
  );
}
