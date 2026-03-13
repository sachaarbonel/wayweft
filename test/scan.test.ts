import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applySafeFixes } from "../src/fixes/index.js";
import { installSkillBundles } from "../src/skills/index.js";
import { scanWorkspace } from "../src/analyzer/index.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testDir, "fixtures", "monorepo");
const tempDirs: string[] = [];

describe("scanWorkspace", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("finds package-aware findings in a monorepo fixture", async () => {
    const result = await scanWorkspace({
      cwd: fixtureRoot,
      target: { scope: "workspace" },
      minScore: 0,
    });

    expect(result.workspace.packages.map((pkg) => pkg.name).sort()).toEqual(["fixture-monorepo", "pkg-a", "pkg-b"]);
    expect(result.findings.some((finding) => finding.ruleId === "too-many-params")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "boolean-param")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "import-cycle")).toBe(true);
    expect(result.findings.some((finding) => finding.ruleId === "prefer-direct-boolean-return")).toBe(true);
  });

  it("builds safe fix plans for supported rewrites", async () => {
    const result = await scanWorkspace({
      cwd: fixtureRoot,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const fixResult = applySafeFixes(result.findings, false);
    expect(fixResult.plans.length).toBeGreaterThan(0);
    expect(fixResult.preview).toContain("safe-rewrites");
  });

  it("installs portable skill bundles and guidance files", () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "refactor-scout-"));
    tempDirs.push(rootDir);

    const written = installSkillBundles({
      rootDir,
      packageDirs: [path.join(rootDir, "packages", "web")],
    });

    expect(written.some((entry) => entry.endsWith("/AGENTS.md"))).toBe(true);
    expect(written.some((entry) => entry.endsWith("/CLAUDE.md"))).toBe(true);
    expect(written.some((entry) => entry.includes(".agents/skills/refactor-scout"))).toBe(true);
    expect(written.some((entry) => entry.includes(".claude/skills/refactor-scout"))).toBe(true);
  });
});
