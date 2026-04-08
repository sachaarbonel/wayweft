import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/analyzer/index";
import { createTreeSitterParser } from "../src/analyzer/parsers/tree-sitter-parser";
import { extractRustFunctions, extractRustImports } from "../src/analyzer/extractors/rust";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rustCrateFixture = path.join(testDir, "fixtures", "rust-crate");
const rustWorkspaceFixture = path.join(testDir, "fixtures", "rust-workspace");

describe("Rust tree-sitter parser", () => {
  it("initializes and parses a Rust file", async () => {
    const tsParser = await createTreeSitterParser();
    const code = `fn hello(name: &str) -> String { format!("Hello, {}!", name) }`;
    const tree = tsParser.parseRust(code);
    expect(tree.rootNode.type).toBe("source_file");
  });
});

describe("Rust function extractor", () => {
  it("extracts function info from a Rust file", async () => {
    const tsParser = await createTreeSitterParser();
    const filePath = path.join(rustCrateFixture, "src", "main.rs");
    const functions = extractRustFunctions(filePath, "rust-crate", tsParser);

    expect(functions.length).toBeGreaterThan(0);
    expect(functions.every((fn) => fn.language === "rust")).toBe(true);
    expect(functions.every((fn) => fn.filePath === filePath)).toBe(true);
  });

  it("detects boolean parameters in Rust functions", async () => {
    const tsParser = await createTreeSitterParser();
    const filePath = path.join(rustCrateFixture, "src", "main.rs");
    const functions = extractRustFunctions(filePath, "rust-crate", tsParser);

    const boolFn = functions.find((fn) => fn.hasBooleanParams);
    expect(boolFn).toBeDefined();
    expect(boolFn?.name).toBeTruthy();
  });

  it("counts parameters correctly", async () => {
    const tsParser = await createTreeSitterParser();
    const filePath = path.join(rustCrateFixture, "src", "main.rs");
    const functions = extractRustFunctions(filePath, "rust-crate", tsParser);

    const processFn = functions.find((fn) => fn.name === "process");
    expect(processFn).toBeDefined();
    expect(processFn!.parameterCount).toBe(5);
  });

  it("computes nesting depth correctly", async () => {
    const tsParser = await createTreeSitterParser();
    const filePath = path.join(rustCrateFixture, "src", "main.rs");
    const functions = extractRustFunctions(filePath, "rust-crate", tsParser);

    const classifyFn = functions.find((fn) => fn.name === "classify");
    expect(classifyFn).toBeDefined();
    expect(classifyFn!.maxNestingDepth).toBeGreaterThanOrEqual(4);
  });
});

describe("Rust import extractor", () => {
  it("extracts use declarations from a Rust file", async () => {
    const tsParser = await createTreeSitterParser();
    const filePath = path.join(rustCrateFixture, "src", "main.rs");
    const imports = extractRustImports(filePath, tsParser);

    expect(imports.some((imp) => imp.includes("std::collections::HashMap"))).toBe(true);
  });
});

describe("scanWorkspace with Rust single-crate", () => {
  it("discovers Rust source files in a single-crate project", async () => {
    const result = await scanWorkspace({
      cwd: rustCrateFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustFiles = result.workspace.fileInventory.filter((f) => f.endsWith(".rs"));
    expect(rustFiles.length).toBeGreaterThan(0);
  });

  it("detects package from Cargo.toml", async () => {
    const result = await scanWorkspace({
      cwd: rustCrateFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const pkgNames = result.workspace.packages.map((p) => p.name);
    expect(pkgNames).toContain("rust-crate");
  });

  it("finds too-many-params findings in Rust files", async () => {
    const result = await scanWorkspace({
      cwd: rustCrateFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustTooManyParams = result.findings.filter(
      (f) => f.ruleId === "too-many-params" && f.filePath.endsWith(".rs"),
    );
    expect(rustTooManyParams.length).toBeGreaterThan(0);
  });

  it("finds boolean-param findings in Rust files", async () => {
    const result = await scanWorkspace({
      cwd: rustCrateFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustBoolParam = result.findings.filter(
      (f) => f.ruleId === "boolean-param" && f.filePath.endsWith(".rs"),
    );
    expect(rustBoolParam.length).toBeGreaterThan(0);
  });

  it("finds deep-nesting findings in Rust files", async () => {
    const result = await scanWorkspace({
      cwd: rustCrateFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustDeepNesting = result.findings.filter(
      (f) => f.ruleId === "deep-nesting" && f.filePath.endsWith(".rs"),
    );
    expect(rustDeepNesting.length).toBeGreaterThan(0);
  });
});

describe("scanWorkspace with Rust workspace", () => {
  it("discovers packages from Cargo.toml workspace members", async () => {
    const result = await scanWorkspace({
      cwd: rustWorkspaceFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const pkgNames = result.workspace.packages.map((p) => p.name).sort();
    expect(pkgNames).toContain("crate-a");
    expect(pkgNames).toContain("crate-b");
  });

  it("discovers Rust source files across workspace members", async () => {
    const result = await scanWorkspace({
      cwd: rustWorkspaceFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustFiles = result.workspace.fileInventory.filter((f) => f.endsWith(".rs"));
    expect(rustFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("finds Rust rule violations across workspace members", async () => {
    const result = await scanWorkspace({
      cwd: rustWorkspaceFixture,
      target: { scope: "workspace" },
      minScore: 0,
    });

    const rustFindings = result.findings.filter((f) => f.filePath.endsWith(".rs"));
    expect(rustFindings.length).toBeGreaterThan(0);
  });
});
