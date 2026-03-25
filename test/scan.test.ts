import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatJsonReport, formatMarkdownReport, formatTextReport } from "../src/reporters/index";
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

  it("adds heuristic nearby-test hints for changed source files", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-test-impact-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "test-impact-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/math.ts", "export function sum(a: number, b: number) { return a + b; }\n");
    writeWorkspaceFile(rootDir, "tests/math.test.ts", "import { sum } from '../src/math';\nexpect(sum(1, 2)).toBe(3);\n");
    writeWorkspaceFile(rootDir, "src/untested.ts", "export const untested = () => 'initial';\n");

    initializeGitFixture(rootDir);
    writeWorkspaceFile(rootDir, "src/math.ts", "export function sum(a: number, b: number) { return a + b + 1; }\n");
    writeWorkspaceFile(rootDir, "src/untested.ts", "export const untested = () => 'changed';\n");
    stageGitFiles(rootDir, ["src/math.ts", "src/untested.ts"]);

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "changed" },
      minScore: 0,
    });

    const findings = result.findings.filter((finding) => finding.ruleId === "test-impact-hint");
    const byFile = new Map(findings.map((finding) => [path.relative(result.workspace.rootDir, finding.filePath), finding]));

    expect(byFile.get("src/math.ts")?.title).toBe("Likely related tests for changed source");
    expect(byFile.get("src/math.ts")?.message).toContain("tests/math.test.ts");
    expect(byFile.get("src/untested.ts")?.title).toBe("Changed source without nearby tests");
    expect(byFile.get("src/untested.ts")?.message).toContain("path-and-name heuristic");
  });

  it("matches separate test directories for changed source files in package layouts", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-test-impact-package-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(
      rootDir,
      "package.json",
      JSON.stringify({ name: "test-impact-monorepo", workspaces: ["packages/*"] }, null, 2),
    );
    writeWorkspaceFile(rootDir, "packages/app/package.json", JSON.stringify({ name: "app" }, null, 2));
    writeWorkspaceFile(rootDir, "packages/app/src/utils/format.ts", "export const format = (value: string) => value.trim();\n");
    writeWorkspaceFile(
      rootDir,
      "packages/app/test/utils/format.spec.ts",
      "import { format } from '../../src/utils/format';\nexpect(format(' x ')).toBe('x');\n",
    );

    initializeGitFixture(rootDir);
    writeWorkspaceFile(
      rootDir,
      "packages/app/src/utils/format.ts",
      "export const format = (value: string) => value.trim().toUpperCase();\n",
    );
    stageGitFiles(rootDir, ["packages/app/src/utils/format.ts"]);

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "changed" },
      minScore: 0,
    });

    const finding = result.findings.find(
      (entry) =>
        entry.ruleId === "test-impact-hint" &&
        path.relative(result.workspace.rootDir, entry.filePath) === "packages/app/src/utils/format.ts",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("packages/app/test/utils/format.spec.ts");
  });

  it("ranks multi-signal hotspots without letting loc dominate on its own", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-hotspots-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "hotspot-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/large.ts", createLongFunctionSource("largeStableModule", 80));
    writeWorkspaceFile(rootDir, "src/shared-risk.ts", createSharedRiskModule("sharedRisk"));
    writeWorkspaceFile(rootDir, "src/consumer-a.ts", "import { sharedRisk } from './shared-risk';\nexport const a = () => sharedRisk(1);\n");
    writeWorkspaceFile(rootDir, "src/consumer-b.ts", "import { sharedRisk } from './shared-risk';\nexport const b = () => sharedRisk(2);\n");

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const relativeHotspots = result.fileHotspots.map((hotspot) => path.relative(result.workspace.rootDir, hotspot.filePath));
    const largeHotspot = result.fileHotspots.find((hotspot) => hotspot.filePath.endsWith("src/large.ts"));
    const textReport = formatTextReport(result);

    expect(relativeHotspots[0]).toBe("src/shared-risk.ts");
    expect(result.fileHotspots[0]?.topSignals.join(" ")).toContain("coupling");
    expect(largeHotspot?.seamHints).toEqual(expect.arrayContaining([
      expect.stringContaining("oversized export largeStableModule"),
    ]));
    expect(textReport).toContain("seams oversized export largeStableModule");
    expect(result.findings.some((finding) => finding.ruleId === "hotspot-score" && finding.filePath.endsWith("src/shared-risk.ts"))).toBe(true);
  });

  it("adds blast-radius and change-risk findings for changed shared modules", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-change-risk-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "change-risk-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/shared/router.ts", "export const buildRoute = (slug: string) => `/products/${slug}`;\n");
    writeWorkspaceFile(rootDir, "src/pages/home.ts", "import { buildRoute } from '../shared/router';\nexport const home = () => buildRoute('home');\n");
    writeWorkspaceFile(rootDir, "src/pages/detail.ts", "import { buildRoute } from '../shared/router';\nexport const detail = () => buildRoute('detail');\n");

    initializeGitFixture(rootDir);
    writeWorkspaceFile(rootDir, "src/shared/router.ts", createSharedRiskModule("buildRoute"));
    stageGitFiles(rootDir, ["src/shared/router.ts"]);

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "changed" },
      minScore: 0,
    });

    const byRule = new Map(result.findings.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get("blast-radius")?.message).toContain("src/shared/router.ts can affect 2 downstream modules");
    expect(byRule.get("change-risk")?.message).toContain("shared-utility-path");
    expect(byRule.get("change-risk")?.message).toContain("fan-in=2");
  });

  it("detects high-confidence near-duplicate function families within a package", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-near-duplicate-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "near-duplicate-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/orders.ts", createNearDuplicateHelper("buildOrderSummary", "order", "summary"));
    writeWorkspaceFile(rootDir, "src/invoices.ts", createNearDuplicateHelper("buildInvoiceSummary", "invoice", "details"));

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const finding = result.findings.find((entry) => entry.ruleId === "near-duplicate-function");
    expect(finding).toBeDefined();
    expect(result.findings.filter((entry) => entry.ruleId === "near-duplicate-function")).toHaveLength(1);
    expect(finding?.title).toBe("Near-duplicate function family");
    expect(finding?.message).toContain("2 function");
    expect(finding?.evidence).toEqual(expect.arrayContaining([
      "family-size=2",
      "member=src/invoices.ts:1:buildInvoiceSummary",
      "member=src/orders.ts:1:buildOrderSummary",
    ]));
  });

  it("collapses three-member duplicate families into one actionable finding", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-near-duplicate-family-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "near-duplicate-family-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/orders.ts", createNearDuplicateHelper("buildOrderSummary", "order", "summary"));
    writeWorkspaceFile(rootDir, "src/invoices.ts", createNearDuplicateHelper("buildInvoiceSummary", "invoice", "details"));
    writeWorkspaceFile(rootDir, "src/shipments.ts", createNearDuplicateHelper("buildShipmentSummary", "shipment", "result"));

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const nearDuplicateFindings = result.findings.filter((entry) => entry.ruleId === "near-duplicate-function");
    expect(nearDuplicateFindings).toHaveLength(1);
    expect(nearDuplicateFindings[0]?.message).toContain("3 function");
    expect(nearDuplicateFindings[0]?.evidence).toEqual(expect.arrayContaining([
      "family-size=3",
      "member=src/invoices.ts:1:buildInvoiceSummary",
      "member=src/orders.ts:1:buildOrderSummary",
      "member=src/shipments.ts:1:buildShipmentSummary",
    ]));
  });

  it("reduces test/setup noise while keeping production duplicate families visible", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-near-duplicate-noise-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "near-duplicate-noise-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/orders.ts", createNearDuplicateHelper("buildOrderSummary", "order", "summary"));
    writeWorkspaceFile(rootDir, "src/invoices.ts", createNearDuplicateHelper("buildInvoiceSummary", "invoice", "details"));
    writeWorkspaceFile(rootDir, "test/orders.test.ts", createNearDuplicateHelper("buildOrderTestSummary", "order", "summary"));
    writeWorkspaceFile(rootDir, "test/invoices.test.ts", createNearDuplicateHelper("buildInvoiceTestSummary", "invoice", "details"));
    writeWorkspaceFile(rootDir, "setup/bootstrap.setup.ts", createNearDuplicateHelper("buildBootstrapSummary", "bootstrap", "summary"));
    writeWorkspaceFile(rootDir, "setup/seed.setup.ts", createNearDuplicateHelper("buildSeedSummary", "seed", "details"));

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const nearDuplicateFindings = result.findings.filter((entry) => entry.ruleId === "near-duplicate-function");
    expect(nearDuplicateFindings).toHaveLength(1);
    expect(nearDuplicateFindings[0]?.evidence).toEqual(expect.arrayContaining([
      "family-size=2",
      "member=src/invoices.ts:1:buildInvoiceSummary",
      "member=src/orders.ts:1:buildOrderSummary",
    ]));
    expect(nearDuplicateFindings[0]?.evidence?.some((entry) => entry.includes("[test]") || entry.includes("[setup]"))).toBe(false);
  });

  it("adds workspace triage summaries to scan results and human-facing reports", async () => {
    const result = await scanWorkspace({
      cwd: fixtureRoot,
      target: { scope: "workspace" },
      minScore: 0,
    });

    expect(result.triage?.scope).toBe("workspace");
    expect(result.triage?.themes.length).toBeGreaterThan(0);
    expect(result.triage?.startHere.length).toBeGreaterThan(0);
    expect(result.triage?.startHere[0]?.rank).toBe(1);

    const text = formatTextReport(result);
    const markdown = formatMarkdownReport(result);
    const json = formatJsonReport(result);

    expect(text).toContain("Triage:");
    expect(text).toContain("Start here:");
    expect(markdown).toContain("## Triage");
    expect(markdown).toContain("### Start here");
    expect(json).toContain("\"triage\"");
    expect(json).toContain("\"startHere\"");
  });

  it("keeps changed-scope scans on the existing review path without workspace triage", async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "wayweft-triage-changed-"));
    tempDirs.push(rootDir);
    writeWorkspaceFile(rootDir, "package.json", JSON.stringify({ name: "triage-changed-fixture" }, null, 2));
    writeWorkspaceFile(rootDir, "src/value.ts", "export const value = 1;\n");

    initializeGitFixture(rootDir);
    writeWorkspaceFile(rootDir, "src/value.ts", "export const value = 2;\n");
    stageGitFiles(rootDir, ["src/value.ts"]);

    const result = await scanWorkspace({
      cwd: rootDir,
      target: { scope: "changed" },
      minScore: 0,
    });

    expect(result.triage).toBeUndefined();
    expect(formatTextReport(result)).not.toContain("Triage:");
  });
});

function writeWorkspaceFile(rootDir: string, relativePath: string, content: string) {
  const filePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function initializeGitFixture(rootDir: string) {
  execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Wayweft Test"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "wayweft@example.com"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: rootDir, stdio: "ignore" });
}

function stageGitFiles(rootDir: string, relativePaths: string[]) {
  execFileSync("git", ["add", ...relativePaths], { cwd: rootDir, stdio: "ignore" });
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

function createSharedRiskModule(name: string): string {
  return [
    `export function ${name}(value: number) {`,
    "  const next = value > 5 ? value - 1 : value + 1;",
    "  if (next > 10) {",
    "    return next * 2;",
    "  }",
    "  if (next < 0) {",
    "    return 0;",
    "  }",
    "  return next;",
    "}",
  ].join("\n");
}

function createNearDuplicateHelper(name: string, itemName: string, fieldName: string): string {
  return [
    `export function ${name}(${itemName}: { id: string; amount: number; status?: string }) {`,
    `  const ${fieldName} = {`,
    `    id: ${itemName}.id,`,
    `    label: ${itemName}.status ?? 'draft',`,
    `    total: ${itemName}.amount * 100,`,
    "  };",
    `  if (${fieldName}.total > 1000) {`,
    `    return { ...${fieldName}, priority: 'high' };`,
    "  }",
    `  return { ...${fieldName}, priority: 'normal' };`,
    "}",
  ].join("\n");
}
