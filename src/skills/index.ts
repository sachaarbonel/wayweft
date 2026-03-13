import path from "node:path";
import { ensureDir, writeText } from "../utils/fs.js";

const skillReadme = `---
name: refactor-scout
description: Analyze a TypeScript repo or monorepo for concrete refactoring opportunities, rank the findings, and optionally apply safe codemods. Use for code smell detection, monorepo hotspot analysis, complexity reduction, duplicate utility detection, and scoped cleanup work.
---

When invoked:

1. Determine the current scope from the working directory.
   - If inside a package, prefer package scope first.
   - If the user asks for broad analysis, use workspace scope.

2. Run:
   - \`refactor-scout scan --format json --output .tmp/refactor-scout.json\`
   - For quick review on large repos, use \`--scope changed\` when appropriate.

3. Read the report and group findings into:
   - safe quick wins
   - architectural hotspots
   - findings requiring human judgment

4. Prefer safe fixes first.
   - Only use fixes marked safe.
   - Use dry-run unless the user clearly asked for edits.

5. After any edits:
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
- Workspace scan: \`refactor-scout scan --scope workspace --format text\`
- Package scan: \`refactor-scout scan --scope package:<name> --format text\`
- Safe fixes: \`refactor-scout fix --dry-run\`

## Guidance
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
- Run \`refactor-scout scan\` before and after edits.
- Validate with package-local lint and tests after safe fixes.
- Treat generated files and migrations as read-only.

## Preferred workflow
- Start with advisory findings.
- Apply only safe fixes by default.
- Escalate architecture findings for review before broad changes.
`,
  );
}
