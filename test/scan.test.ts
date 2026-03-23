import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applySafeFixes } from "../src/fixes/index";
import { installSkillBundles } from "../src/skills/index";
import { scanWorkspace } from "../src/analyzer/index";

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
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-"));
    tempDirs.push(rootDir);

    const written = installSkillBundles({
      rootDir,
      packageDirs: [path.join(rootDir, "packages", "web")],
    });

    expect(written.some((entry) => entry.endsWith("/AGENTS.md"))).toBe(true);
    expect(written.some((entry) => entry.endsWith("/CLAUDE.md"))).toBe(true);
    expect(written.some((entry) => entry.includes(".agents/skills/wayweft"))).toBe(true);
    expect(written.some((entry) => entry.includes(".claude/skills/wayweft"))).toBe(true);
  });

  it("ignores generated and vendored files by default but allows opting back in", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-ignore-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "ignore-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/index.ts", "export const value = 1;\n");
    writeWorkspaceFile(rootDir, "dist/generated.ts", "export const distValue = 2;\n");
    writeWorkspaceFile(rootDir, "build/generated.ts", "export const buildValue = 3;\n");
    writeWorkspaceFile(rootDir, ".next/server/page.ts", "export const nextValue = 4;\n");
    writeWorkspaceFile(rootDir, "coverage/report.ts", "export const coverageValue = 5;\n");
    writeWorkspaceFile(rootDir, "__snapshots__/component.ts", "export const snapshotValue = 6;\n");
    writeWorkspaceFile(rootDir, "vendor/library.ts", "export const vendorValue = 7;\n");
    writeWorkspaceFile(rootDir, "public/app.min.js", "export const minifiedValue = 8;\n");
    writeWorkspaceFile(rootDir, "types/schema.generated.ts", "export const generatedValue = 9;\n");

    const defaultResult = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });
    writeWorkspaceFile(rootDir, "wayweft.config.json", JSON.stringify({ ignore: [] }, null, 2));
    const optedInResult = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const defaultInventory = defaultResult.workspace.fileInventory.map((filePath) =>
      path.relative(defaultResult.workspace.rootDir, filePath),
    );
    const optedInInventory = optedInResult.workspace.fileInventory.map((filePath) =>
      path.relative(optedInResult.workspace.rootDir, filePath),
    );

    expect(defaultInventory).toEqual(["src/index.ts"]);
    expect(optedInInventory).toEqual(expect.arrayContaining([
      ".next/server/page.ts",
      "__snapshots__/component.ts",
      "build/generated.ts",
      "coverage/report.ts",
      "dist/generated.ts",
      "public/app.min.js",
      "src/index.ts",
      "types/schema.generated.ts",
      "vendor/library.ts",
    ]));
  });

  it("respects root and nested ignore files during inventory discovery", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-gitignore-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "gitignore-fixture", workspaces: ["packages/*"] }, null, 2),
    );
    writeWorkspaceFile(rootDir, "src/index.ts", "export const value = 1;\n");
    writeWorkspaceFile(rootDir, "ignored-root/skip.ts", "export const skipped = 2;\n");
    writeWorkspaceFile(rootDir, "packages/app/src/keep.ts", "export const kept = 3;\n");
    writeWorkspaceFile(rootDir, "packages/app/generated/skip.ts", "export const generated = 4;\n");
    writeWorkspaceFile(rootDir, "packages/app/generated/keep.ts", "export const optIn = 5;\n");
    writeWorkspaceFile(rootDir, ".gitignore", "ignored-root/\n");
    writeWorkspaceFile(rootDir, "packages/app/.ignore", "generated/*\n!generated/keep.ts\n");

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const inventory = result.workspace.fileInventory.map((filePath) =>
      path.relative(result.workspace.rootDir, filePath),
    );

    expect(inventory).toEqual(expect.arrayContaining([
      "packages/app/generated/keep.ts",
      "packages/app/src/keep.ts",
      "src/index.ts",
    ]));
    expect(inventory).not.toContain("ignored-root/skip.ts");
    expect(inventory).not.toContain("packages/app/generated/skip.ts");
  });

  it("tunes long-function findings by file context", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-long-function-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "long-function-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/plain.ts", createLongFunctionSource("plainHotspot", 48));
    writeWorkspaceFile(rootDir, "src/component.tsx", createJsxHeavyComponent("CatalogPanel", 39, 8));
    writeWorkspaceFile(rootDir, "test/catalog.test.ts", createLongFunctionSource("catalogRegression", 58));
    writeWorkspaceFile(rootDir, "scripts/build.ts", createLongFunctionSource("buildRelease", 52));

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const longFunctionFindings = result.findings.filter((finding) => finding.ruleId === "long-function");
    const findingByFile = new Map(
      longFunctionFindings.map((finding) => [path.relative(result.workspace.rootDir, finding.filePath), finding]),
    );

    expect(findingByFile.get("src/plain.ts")?.message).toContain("configured threshold of 45");
    expect(findingByFile.get("src/plain.ts")?.evidence).toContain("threshold=45");
    expect(findingByFile.has("src/component.tsx")).toBe(false);
    expect(findingByFile.has("test/catalog.test.ts")).toBe(false);
    expect(findingByFile.has("scripts/build.ts")).toBe(false);
  });

  it("explains adjusted long-function thresholds when context-heavy files still exceed them", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-long-function-context-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "long-function-context-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/heavy-component.tsx", createJsxHeavyComponent("HeavyComponent", 62, 10));

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const finding = result.findings.find(
      (entry) => entry.ruleId === "long-function" && entry.filePath.endsWith("src/heavy-component.tsx"),
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("adjusted threshold of 55 for JSX-heavy files context");
    expect(finding?.evidence).toContain("threshold=55");
    expect(finding?.evidence).toContain("context=JSX-heavy files");
  });
});

function writeWorkspaceFile(rootDir: string, relativePath: string, content: string) {
  const filePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function createLongFunctionSource(name: string, statementCount: number): string {
  const statements = Array.from({ length: statementCount }, (_, index) => `  total += ${index + 1};`).join("\n");
  return [
    `export function ${name}() {`,
    "  let total = 0;",
    statements,
    "  return total;",
    "}",
  ].join("\n");
}

function createJsxHeavyComponent(name: string, statementCount: number, jsxElementCount: number): string {
  const statements = Array.from({ length: statementCount }, (_, index) => `  const value${index + 1} = ${index + 1};`).join("\n");
  const jsxLines = Array.from(
    { length: jsxElementCount },
    (_, index) => `      <section data-slot="${index + 1}">{value${Math.min(index + 1, statementCount)}}</section>`,
  ).join("\n");

  return [
    `export function ${name}() {`,
    statements,
    "  return (",
    "    <>",
    jsxLines,
    "    </>",
    "  );",
    "}",
  ].join("\n");
}
