import path from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { FileHotspot, HotspotSignals, Workspace, WorkspacePackage } from "../types";
import { normalizePath } from "../utils/fs";

export interface ModuleGraphNode {
  filePath: string;
  relativePath: string;
  packageName?: string;
  loc: number;
  complexity: number;
  churn: number;
  ownership: number;
  imports: string[];
  importedBy: string[];
  fanOut: number;
  fanIn: number;
  blastRadius: number;
  componentSize: number;
}

export interface ModuleGraphAnalysis {
  nodes: Map<string, ModuleGraphNode>;
  fileHotspots: FileHotspot[];
}

export function mapFilesToPackages(workspace: Workspace): Map<string, WorkspacePackage> {
  const map = new Map<string, WorkspacePackage>();
  for (const pkg of workspace.packages) {
    for (const filePath of workspace.fileInventory) {
      if (filePath.startsWith(pkg.dir)) {
        map.set(filePath, pkg);
      }
    }
  }
  return map;
}

export function analyzeModules(input: {
  workspace: Workspace;
  project: Project;
  fileToPackage: Map<string, WorkspacePackage>;
  churnByFile: Map<string, number>;
  ownershipByFile: Map<string, number>;
}): ModuleGraphAnalysis {
  const sourceFiles = input.project.getSourceFiles();
  const sourceFileByPath = new Map<string, SourceFile>();
  for (const sourceFile of sourceFiles) {
    sourceFileByPath.set(sourceFile.getFilePath(), sourceFile);
  }
  const fileSet = new Set(input.workspace.fileInventory);
  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  const seamHintsByFile = new Map<string, string[]>();

  for (const filePath of fileSet) {
    imports.set(filePath, new Set());
    importedBy.set(filePath, new Set());
  }

  for (const sourceFile of sourceFiles) {
    const fromPath = sourceFile.getFilePath();
    if (!fileSet.has(fromPath)) {
      continue;
    }

    const relativePath = normalizePath(path.relative(input.workspace.rootDir, fromPath));
    seamHintsByFile.set(fromPath, collectSplitSeamHints(sourceFile, relativePath));

    for (const declaration of sourceFile.getImportDeclarations()) {
      const target = resolveImportTarget(sourceFile, declaration.getModuleSpecifierValue(), sourceFileByPath, fileSet);
      if (!target) {
        continue;
      }
      imports.get(fromPath)?.add(target);
      importedBy.get(target)?.add(fromPath);
    }
  }

  const components = stronglyConnectedComponents(imports);
  const componentByFile = new Map<string, string[]>();
  for (const component of components) {
    for (const filePath of component) {
      componentByFile.set(filePath, component);
    }
  }

  const nodes = new Map<string, ModuleGraphNode>();
  for (const filePath of input.workspace.fileInventory) {
    const sourceFile = sourceFileByPath.get(filePath);
    if (!sourceFile) {
      continue;
    }
    const relativePath = normalizePath(path.relative(input.workspace.rootDir, filePath));
    const pkg = input.fileToPackage.get(filePath);
    const importList = [...(imports.get(filePath) ?? [])].sort();
    const importedByList = [...(importedBy.get(filePath) ?? [])].sort();
    const component = componentByFile.get(filePath) ?? [filePath];
    nodes.set(filePath, {
      filePath,
      relativePath,
      packageName: pkg?.name,
      loc: countLoc(sourceFile),
      complexity: estimateComplexity(sourceFile),
      churn: input.churnByFile.get(relativePath) ?? 0,
      ownership: input.ownershipByFile.get(relativePath) ?? 0,
      imports: importList,
      importedBy: importedByList,
      fanOut: importList.length,
      fanIn: importedByList.length,
      blastRadius: reachableDependents(filePath, importedBy),
      componentSize: component.length,
    });
  }

  const fileHotspots = buildFileHotspots([...nodes.values()], seamHintsByFile);
  return { nodes, fileHotspots };
}

function resolveImportTarget(
  sourceFile: SourceFile,
  specifier: string,
  sourceFileByPath: Map<string, SourceFile>,
  fileSet: Set<string>,
): string | undefined {
  const resolved = sourceFile.getImportDeclaration((declaration) => declaration.getModuleSpecifierValue() === specifier)
    ?.getModuleSpecifierSourceFile()
    ?.getFilePath();
  if (resolved && fileSet.has(resolved)) {
    return resolved;
  }

  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const base = path.resolve(path.dirname(sourceFile.getFilePath()), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
  ];

  return candidates.find((candidate) => fileSet.has(candidate) || sourceFileByPath.has(candidate));
}

function stronglyConnectedComponents(graph: Map<string, Set<string>>): string[][] {
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  function visit(node: string) {
    indexByNode.set(node, index);
    lowLinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indexByNode.has(dependency)) {
        visit(dependency);
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node)!, lowLinkByNode.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node)!, indexByNode.get(dependency)!));
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === node) {
        break;
      }
    }
    components.push(component.sort());
  }

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) {
      visit(node);
    }
  }

  return components;
}

function reachableDependents(filePath: string, importedBy: Map<string, Set<string>>): number {
  const seen = new Set<string>();
  const queue = [...(importedBy.get(filePath) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const dependent of importedBy.get(current) ?? []) {
      if (!seen.has(dependent)) {
        queue.push(dependent);
      }
    }
  }

  return seen.size;
}

function buildFileHotspots(nodes: ModuleGraphNode[], seamHintsByFile: Map<string, string[]>): FileHotspot[] {
  const weights: Array<[keyof HotspotSignals, number]> = [
    ["loc", 0.15],
    ["churn", 0.25],
    ["complexity", 0.25],
    ["coupling", 0.25],
    ["ownership", 0.1],
  ];
  const maxima = {
    loc: Math.max(...nodes.map((node) => node.loc), 1),
    churn: Math.max(...nodes.map((node) => node.churn), 1),
    complexity: Math.max(...nodes.map((node) => node.complexity), 1),
    coupling: Math.max(...nodes.map((node) => node.fanIn + node.fanOut + node.blastRadius), 1),
    ownership: Math.max(...nodes.map((node) => node.ownership), 1),
  };

  return nodes
    .map((node) => {
      const signals: HotspotSignals = {
        loc: normalizedPercent(node.loc, maxima.loc),
        churn: normalizedPercent(node.churn, maxima.churn),
        complexity: normalizedPercent(node.complexity, maxima.complexity),
        coupling: normalizedPercent(node.fanIn + node.fanOut + node.blastRadius, maxima.coupling),
        ownership: normalizedPercent(node.ownership, maxima.ownership),
      };
      const score = Math.round(
        weights.reduce((total, [key, weight]) => total + (signals[key] ?? 0) * weight, 0),
      );
      const topSignals = Object.entries(signals)
        .sort((left, right) => right[1]! - left[1]!)
        .filter(([, value]) => (value ?? 0) >= 20)
        .slice(0, 3)
        .map(([key, value]) => `${key}=${value}`);

      return {
        filePath: node.filePath,
        packageName: node.packageName,
        score,
        signals,
        topSignals,
        seamHints: seamHintsByFile.get(node.filePath) ?? [],
      };
    })
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .slice(0, 10);
}

interface TopLevelCallable {
  name: string;
  exported: boolean;
  statementCount: number;
  kind: "function" | "arrow" | "class";
}

function collectSplitSeamHints(sourceFile: SourceFile, relativePath: string): string[] {
  const callables = collectTopLevelCallables(sourceFile);
  const hints: string[] = [];

  const oversizedExport = [...callables]
    .filter((callable) => callable.exported && callable.statementCount >= 16)
    .sort((left, right) => right.statementCount - left.statementCount || left.name.localeCompare(right.name))[0];
  if (oversizedExport) {
    hints.push(`oversized export ${oversizedExport.name} (${oversizedExport.statementCount} stmts)`);
  }

  const helperGroups = new Map<string, TopLevelCallable[]>();
  for (const callable of callables) {
    if (callable.exported || callable.statementCount > 12) {
      continue;
    }
    const prefix = normalizeHelperPrefix(callable.name);
    if (!prefix) {
      continue;
    }
    const group = helperGroups.get(prefix) ?? [];
    group.push(callable);
    helperGroups.set(prefix, group);
  }

  const repeatedHelperGroup = [...helperGroups.entries()]
    .filter(([, group]) => group.length >= 3)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
  if (repeatedHelperGroup) {
    hints.push(`helper group ${repeatedHelperGroup[0]}* x${repeatedHelperGroup[1].length}`);
  }

  const functionClusterCount = callables.filter((callable) => callable.kind === "function" || callable.kind === "arrow").length;
  if (functionClusterCount >= 5) {
    hints.push(`function cluster ${functionClusterCount} top-level callables`);
  }

  const routeHint = collectRouteHint(relativePath, callables);
  if (routeHint) {
    hints.push(routeHint);
  }

  return [...new Set(hints)].slice(0, 3);
}

function collectTopLevelCallables(sourceFile: SourceFile): TopLevelCallable[] {
  const callables: TopLevelCallable[] = [];

  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (!name) {
      continue;
    }
    callables.push({
      name,
      exported: declaration.isExported(),
      statementCount: countFunctionStatements(declaration),
      kind: "function",
    });
  }

  for (const declaration of sourceFile.getClasses()) {
    const name = declaration.getName();
    if (!name) {
      continue;
    }
    callables.push({
      name,
      exported: declaration.isExported(),
      statementCount: declaration.getMembers().length,
      kind: "class",
    });
  }

  for (const statement of sourceFile.getVariableStatements()) {
    const exported = statement.isExported();
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) {
        continue;
      }
      callables.push({
        name: declaration.getName(),
        exported,
        statementCount: countFunctionStatements(initializer),
        kind: "arrow",
      });
    }
  }

  return callables;
}

function countFunctionStatements(node: { getBody(): Node | undefined }): number {
  const body = node.getBody();
  if (!body) {
    return 0;
  }
  if (Node.isBlock(body)) {
    return body.getStatements().length;
  }
  return 1;
}

function normalizeHelperPrefix(name: string): string | undefined {
  const parts = name
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .split(/[_\-.]+|(?=[A-Z])/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
  const prefix = parts[0];
  if (!prefix || prefix.length < 4) {
    return undefined;
  }
  return prefix;
}

function collectRouteHint(relativePath: string, callables: TopLevelCallable[]): string | undefined {
  const pathSegments = relativePath.split(/[\\/]/);
  const routeSegment = pathSegments.find((segment) => /^(routes?|router|pages?|layouts?|handlers?|actions?)$/i.test(segment));
  const routeNamedCallables = callables.filter((callable) => /(?:route|router|page|layout|loader|action|handler)/i.test(callable.name));

  if (!routeSegment && routeNamedCallables.length < 2) {
    return undefined;
  }

  if (routeSegment) {
    const index = pathSegments.findIndex((segment) => segment === routeSegment);
    const prefix = pathSegments.slice(0, index + 1).join("/");
    return `route group ${prefix}/*`;
  }

  return `route group ${routeNamedCallables
    .slice(0, 2)
    .map((callable) => callable.name)
    .join(", ")}`;
}

function normalizedPercent(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.round((value / max) * 100);
}

function countLoc(sourceFile: SourceFile): number {
  return sourceFile
    .getFullText()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function estimateComplexity(sourceFile: SourceFile): number {
  const branchKinds = new Set([
    SyntaxKind.IfStatement,
    SyntaxKind.SwitchStatement,
    SyntaxKind.CaseClause,
    SyntaxKind.ConditionalExpression,
    SyntaxKind.ForStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.CatchClause,
    SyntaxKind.BinaryExpression,
  ]);

  return sourceFile.getDescendants().reduce((total, node) => {
    const kind = node.getKind();
    if (!branchKinds.has(kind)) {
      return total;
    }
    if (kind === SyntaxKind.BinaryExpression && !/&&|\|\||\?\?/.test(node.getText())) {
      return total;
    }
    return total + 1;
  }, 1);
}

export function summarizePackageHotspots(
  fileHotspots: FileHotspot[],
  findingsByPackage: Map<string, number>,
): Array<{ packageName: string; totalScore: number; findingCount: number; averageScore: number; topSignals: string[] }> {
  const packages = new Map<string, { totalScore: number; fileCount: number; signalTotals: Map<string, number> }>();
  for (const hotspot of fileHotspots) {
    const packageName = hotspot.packageName ?? path.dirname(hotspot.filePath);
    const entry = packages.get(packageName) ?? { totalScore: 0, fileCount: 0, signalTotals: new Map() };
    entry.totalScore += hotspot.score;
    entry.fileCount += 1;
    for (const [signal, value] of Object.entries(hotspot.signals)) {
      entry.signalTotals.set(signal, (entry.signalTotals.get(signal) ?? 0) + (value ?? 0));
    }
    packages.set(packageName, entry);
  }

  return [...packages.entries()]
    .map(([packageName, value]) => ({
      packageName,
      totalScore: value.totalScore,
      findingCount: findingsByPackage.get(packageName) ?? 0,
      averageScore: Math.round(value.totalScore / Math.max(value.fileCount, 1)),
      topSignals: [...value.signalTotals.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([signal]) => signal),
    }))
    .sort((left, right) => right.totalScore - left.totalScore || left.packageName.localeCompare(right.packageName))
    .slice(0, 10);
}
