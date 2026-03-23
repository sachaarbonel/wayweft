import path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
} from "ts-morph";
import type {
  Finding,
  FindingCategory,
  NormalizedConfig,
  NormalizedRuleConfig,
  Workspace,
  WorkspacePackage,
} from "../types";
import { getChurnMap } from "../utils/git";
import { normalizePath } from "../utils/fs";

interface RuleContext {
  workspace: Workspace;
  config: NormalizedConfig;
  project: Project;
  fileToPackage: Map<string, WorkspacePackage>;
  churnByFile: Map<string, number>;
}

interface LongFunctionContextTuning {
  labels: string[];
  maxLinesBonus: number;
}

export function runRules(
  workspace: Workspace,
  config: NormalizedConfig,
  project: Project,
): Finding[] {
  const fileToPackage = mapFilesToPackages(workspace);
  const churnByFile = config.analysis.includeGitChurn
    ? getChurnMap(workspace.rootDir, workspace.fileInventory.map((file) => path.relative(workspace.rootDir, file)))
    : new Map<string, number>();
  const context: RuleContext = {
    workspace,
    config,
    project,
    fileToPackage,
    churnByFile,
  };
  const findings = [
    ...findFunctionComplexity(project.getSourceFiles(), context),
    ...findSafeRewriteOpportunities(project.getSourceFiles(), context),
    ...findCrossPackageDuplication(project.getSourceFiles(), context),
    ...findImportCycles(context),
    ...findBoundaryViolations(project.getSourceFiles(), context),
  ];
  return findings.sort((left, right) => right.score - left.score);
}

function findFunctionComplexity(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const sourceFile of sourceFiles) {
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      pushFunctionFindings(fn, sourceFile, context, findings);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
      pushFunctionFindings(fn, sourceFile, context, findings);
    }
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
      pushFunctionFindings(fn, sourceFile, context, findings);
    }
  }
  return findings;
}

function pushFunctionFindings(
  fn: FunctionDeclaration | MethodDeclaration | ArrowFunction,
  sourceFile: SourceFile,
  context: RuleContext,
  findings: Finding[],
): void {
  const body = fn.getBody();
  if (!body) {
    return;
  }

  const packageConfig = getPackageRuleConfig(sourceFile.getFilePath(), context);
  const longFunctionTuning = getLongFunctionContextTuning(sourceFile, context);
  const effectiveLongFunctionMaxLines = packageConfig["long-function"].maxLines + longFunctionTuning.maxLinesBonus;
  const lines = body.getEndLineNumber() - body.getStartLineNumber() + 1;
  const depth = getMaxDepth(body);
  const params = fn.getParameters();
  const booleanParams = params.filter((param) => {
    const typeNode = param.getTypeNode();
    return typeNode?.getText() === "boolean";
  });
  const branchCount = body
    .getDescendants()
    .filter((node: Node) =>
      [
        SyntaxKind.IfStatement,
        SyntaxKind.SwitchStatement,
        SyntaxKind.ConditionalExpression,
        SyntaxKind.ForStatement,
        SyntaxKind.ForOfStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.WhileStatement,
      ].includes(node.getKind()),
    ).length;

  if (packageConfig["long-function"].enabled && lines > effectiveLongFunctionMaxLines) {
    const thresholdLabel =
      longFunctionTuning.labels.length > 0
        ? `adjusted threshold of ${effectiveLongFunctionMaxLines} for ${longFunctionTuning.labels.join(" + ")} context`
        : `configured threshold of ${packageConfig["long-function"].maxLines}`;
    findings.push(
      createFunctionFinding({
        fn,
        sourceFile,
        context,
        ruleId: "long-function",
        title: "Long function",
        message: `Function spans ${lines} lines and exceeds the ${thresholdLabel}.`,
        category: "complexity",
        structuralScore: Math.min(40, lines - effectiveLongFunctionMaxLines + 20),
        evidence: [
          `lines=${lines}`,
          `threshold=${effectiveLongFunctionMaxLines}`,
          `branches=${branchCount}`,
          `depth=${depth}`,
          ...longFunctionTuning.labels.map((label) => `context=${label}`),
        ],
        suggestion: "Split the function into smaller units with one control-flow concern each.",
      }),
    );
  }

  if (packageConfig["deep-nesting"].enabled && depth > packageConfig["deep-nesting"].maxDepth) {
    findings.push(
      createFunctionFinding({
        fn,
        sourceFile,
        context,
        ruleId: "deep-nesting",
        title: "Deep nesting",
        message: `Function reaches nesting depth ${depth}, above ${packageConfig["deep-nesting"].maxDepth}.`,
        category: "complexity",
        structuralScore: 25 + depth * 4,
        evidence: [`depth=${depth}`, `branches=${branchCount}`],
        suggestion: "Flatten guard clauses and extract inner branches into helper functions.",
      }),
    );
  }

  if (packageConfig["too-many-params"].enabled && params.length > packageConfig["too-many-params"].maxParams) {
    findings.push(
      createFunctionFinding({
        fn,
        sourceFile,
        context,
        ruleId: "too-many-params",
        title: "Too many parameters",
        message: `Function accepts ${params.length} parameters, above ${packageConfig["too-many-params"].maxParams}.`,
        category: "maintainability",
        structuralScore: 24 + params.length * 5,
        evidence: params.map((param) => param.getName()),
        suggestion: "Introduce a parameter object or split the responsibility across multiple helpers.",
      }),
    );
  }

  if (packageConfig["boolean-param"].enabled && booleanParams.length > 0) {
    findings.push(
      createFunctionFinding({
        fn,
        sourceFile,
        context,
        ruleId: "boolean-param",
        title: "Boolean flag parameter",
        message: `Function exposes boolean flags (${booleanParams.map((param) => param.getName()).join(", ")}) that likely encode multiple behaviors.`,
        category: "maintainability",
        structuralScore: 30 + booleanParams.length * 8,
        evidence: booleanParams.map((param) => param.getName()),
        suggestion: "Split the call path into separate named functions or use an enum-like option.",
        fixId: "boolean-param-wrap",
        safe: false,
      }),
    );
  }
}

function getPackageRuleConfig(filePath: string, context: RuleContext): Record<string, NormalizedRuleConfig> {
  const pkg = context.fileToPackage.get(filePath);
  if (!pkg) {
    return context.config.rules;
  }
  const override = context.config.packages[pkg.name]?.rules ?? {};
  const merged = { ...context.config.rules };
  for (const [ruleId, value] of Object.entries(override)) {
    merged[ruleId] = {
      enabled: value.enabled ?? merged[ruleId]?.enabled ?? true,
      maxLines: value.maxLines ?? merged[ruleId]?.maxLines ?? 45,
      maxDepth: value.maxDepth ?? merged[ruleId]?.maxDepth ?? 3,
      maxParams: value.maxParams ?? merged[ruleId]?.maxParams ?? 4,
    };
  }
  return merged;
}

function getMaxDepth(node: Node, level = 0): number {
  const nestedBlocks = node
    .getChildren()
    .filter((child) =>
      [
        SyntaxKind.IfStatement,
        SyntaxKind.SwitchStatement,
        SyntaxKind.ForStatement,
        SyntaxKind.ForOfStatement,
        SyntaxKind.ForInStatement,
        SyntaxKind.WhileStatement,
        SyntaxKind.Block,
      ].includes(child.getKind()),
    );
  if (nestedBlocks.length === 0) {
    return level;
  }
  return Math.max(...nestedBlocks.map((child) => getMaxDepth(child, level + 1)));
}

function getLongFunctionContextTuning(
  sourceFile: SourceFile,
  context: RuleContext,
): LongFunctionContextTuning {
  const relativePath = normalizePath(path.relative(context.workspace.rootDir, sourceFile.getFilePath()));
  const labels: string[] = [];
  let maxLinesBonus = 0;

  if (isTestLikeFile(relativePath)) {
    labels.push("test files");
    maxLinesBonus += 20;
  }

  if (isScriptLikeFile(relativePath)) {
    labels.push("scripts");
    maxLinesBonus += 15;
  }

  if (isJsxHeavyFile(sourceFile)) {
    labels.push("JSX-heavy files");
    maxLinesBonus += 10;
  }

  return {
    labels,
    maxLinesBonus,
  };
}

function isTestLikeFile(relativePath: string): boolean {
  return (
    /(^|\/)(?:__tests__|tests)\//.test(relativePath) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

function isScriptLikeFile(relativePath: string): boolean {
  return (
    /(^|\/)(?:scripts|tools|bin)\//.test(relativePath) ||
    /(?:^|\/)[^/]+\.(?:config|setup)\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

function isJsxHeavyFile(sourceFile: SourceFile): boolean {
  const filePath = sourceFile.getFilePath();
  if (!/\.[jt]sx$/.test(filePath)) {
    return false;
  }

  const jsxNodeCount =
    sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length +
    sourceFile.getDescendantsOfKind(SyntaxKind.JsxFragment).length;

  return jsxNodeCount >= 8;
}

function createFunctionFinding(input: {
  fn: FunctionDeclaration | MethodDeclaration | ArrowFunction;
  sourceFile: SourceFile;
  context: RuleContext;
  ruleId: string;
  title: string;
  message: string;
  category: FindingCategory;
  structuralScore: number;
  evidence: string[];
  suggestion: string;
  fixId?: string;
  safe?: boolean;
}): Finding {
  const filePath = input.sourceFile.getFilePath();
  const pkg = input.context.fileToPackage.get(filePath);
  const symbolName =
    "getName" in input.fn && typeof input.fn.getName === "function"
      ? input.fn.getName() ?? "<anonymous>"
      : "<anonymous>";
  const start = input.fn.getStart();
  const location = input.sourceFile.getLineAndColumnAtPos(start);
  const churn = input.context.churnByFile.get(path.relative(input.context.workspace.rootDir, filePath)) ?? 0;
  const score = Math.min(
    100,
    Math.round(
      input.structuralScore +
        Math.min(20, churn) +
        (pkg && pkg.internalDependencies.length > 0 ? 5 : 0),
    ),
  );

  return {
    id: `${input.ruleId}:${normalizePath(path.relative(input.context.workspace.rootDir, filePath))}:${location.line}:${symbolName}`,
    ruleId: input.ruleId,
    title: input.title,
    message: input.message,
    category: input.category,
    severity: score >= 75 ? "error" : score >= 40 ? "warning" : "info",
    confidence: input.structuralScore >= 30 ? "high" : "medium",
    score,
    packageName: pkg?.name,
    filePath,
    startLine: location.line,
    startColumn: location.column,
    endLine: input.sourceFile.getLineAndColumnAtPos(input.fn.getEnd()).line,
    endColumn: 1,
    symbolName,
    evidence: input.evidence,
    suggestion: input.suggestion,
    fix: input.fixId
      ? {
          kind: "codemod",
          fixId: input.fixId,
          safe: input.safe ?? false,
        }
      : undefined,
  };
}

function findCrossPackageDuplication(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  const bucket = new Map<string, Array<{ sourceFile: SourceFile; packageName?: string }>>();
  for (const sourceFile of sourceFiles) {
    const pkg = context.fileToPackage.get(sourceFile.getFilePath());
    const functions = sourceFile.getFunctions();
    for (const fn of functions) {
      const body = fn.getBodyText()?.replace(/\s+/g, " ").trim();
      if (!body || body.length < 40) {
        continue;
      }
      const key = body.slice(0, 120);
      const entries = bucket.get(key) ?? [];
      entries.push({ sourceFile, packageName: pkg?.name });
      bucket.set(key, entries);
    }
  }

  const findings: Finding[] = [];
  for (const [snippet, entries] of bucket.entries()) {
    const packageNames = new Set(entries.map((entry) => entry.packageName).filter(Boolean));
    if (entries.length < 2 || packageNames.size < 2) {
      continue;
    }
    for (const entry of entries) {
      const filePath = entry.sourceFile.getFilePath();
      const pkg = context.fileToPackage.get(filePath);
      findings.push({
        id: `cross-package-duplication:${normalizePath(path.relative(context.workspace.rootDir, filePath))}:${packageNames.size}`,
        ruleId: "cross-package-duplication",
        title: "Cross-package duplicated utility",
        message: `A similar function body appears across ${packageNames.size} packages.`,
        category: "duplication",
        severity: "warning",
        confidence: "medium",
        score: Math.min(100, 50 + packageNames.size * 10),
        packageName: pkg?.name,
        filePath,
        startLine: 1,
        startColumn: 1,
        evidence: [snippet],
        suggestion: "Extract the shared helper into a package with explicit ownership.",
      });
    }
  }
  return findings;
}

function findSafeRewriteOpportunities(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const sourceFile of sourceFiles) {
    const pkg = context.fileToPackage.get(sourceFile.getFilePath());

    for (const ifStatement of sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
      const thenStatement = ifStatement.getThenStatement();
      const elseStatement = ifStatement.getElseStatement();
      if (!elseStatement) {
        continue;
      }
      const thenText = thenStatement.getText().replace(/\s+/g, " ").trim();
      const elseText = elseStatement.getText().replace(/\s+/g, " ").trim();
      const conditionText = ifStatement.getExpression().getText();
      const location = sourceFile.getLineAndColumnAtPos(ifStatement.getStart());

      if (thenText === "{ return true; }" && elseText === "{ return false; }") {
        findings.push({
          id: `prefer-direct-boolean-return:${normalizePath(path.relative(context.workspace.rootDir, sourceFile.getFilePath()))}:${location.line}`,
          ruleId: "prefer-direct-boolean-return",
          title: "Boolean return if/else can be simplified",
          message: "An if/else returning true and false can be rewritten as a direct boolean return.",
          category: "maintainability",
          severity: "info",
          confidence: "high",
          score: 32,
          packageName: pkg?.name,
          filePath: sourceFile.getFilePath(),
          startLine: location.line,
          startColumn: location.column,
          evidence: [conditionText],
          suggestion: "Replace the branch with a direct return of the condition.",
          fix: {
            kind: "text-edit",
            fixId: "prefer-direct-boolean-return",
            safe: true,
          },
        });
      }
    }

    for (const conditional of sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
      const conditionText = conditional.getCondition().getText();
      const whenTrue = conditional.getWhenTrue().getText();
      const whenFalse = conditional.getWhenFalse().getText();
      const location = sourceFile.getLineAndColumnAtPos(conditional.getStart());

      const nullishMatch = conditionText.match(/^(.+?)\s*===\s*null\s*\|\|\s*\1\s*===\s*undefined$/);
      if (nullishMatch && whenFalse === nullishMatch[1].trim()) {
        findings.push({
          id: `prefer-nullish-coalescing:${normalizePath(path.relative(context.workspace.rootDir, sourceFile.getFilePath()))}:${location.line}`,
          ruleId: "prefer-nullish-coalescing",
          title: "Nullish fallback can use ??",
          message: "A null/undefined fallback conditional can be rewritten with nullish coalescing.",
          category: "maintainability",
          severity: "info",
          confidence: "high",
          score: 35,
          packageName: pkg?.name,
          filePath: sourceFile.getFilePath(),
          startLine: location.line,
          startColumn: location.column,
          evidence: [conditional.getText()],
          suggestion: "Rewrite the expression using ?? for a shorter equivalent form.",
          fix: {
            kind: "text-edit",
            fixId: "prefer-nullish-coalescing",
            safe: true,
          },
        });
      }

      const optionalChainMatch = conditionText.match(/^(.+?)\s*==\s*null$/);
      if (optionalChainMatch && whenTrue === "undefined") {
        findings.push({
          id: `prefer-optional-chaining:${normalizePath(path.relative(context.workspace.rootDir, sourceFile.getFilePath()))}:${location.line}`,
          ruleId: "prefer-optional-chaining",
          title: "Nullable property access can use optional chaining",
          message: "A null guard returning undefined can be rewritten with optional chaining.",
          category: "maintainability",
          severity: "info",
          confidence: "medium",
          score: 34,
          packageName: pkg?.name,
          filePath: sourceFile.getFilePath(),
          startLine: location.line,
          startColumn: location.column,
          evidence: [conditional.getText()],
          suggestion: "Rewrite the guarded access using optional chaining.",
          fix: {
            kind: "text-edit",
            fixId: "prefer-optional-chaining",
            safe: true,
          },
        });
      }
    }
  }
  return findings;
}

function findImportCycles(context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const graph = context.workspace.packageGraph;
  const seen = new Set<string>();
  for (const [source, deps] of graph.entries()) {
    for (const dep of deps) {
      if ((graph.get(dep) ?? []).includes(source)) {
        const pair = [source, dep].sort().join("::");
        if (seen.has(pair)) {
          continue;
        }
        seen.add(pair);
        const pkg = context.workspace.packages.find((item) => item.name === source);
        findings.push({
          id: `import-cycle:${pair}`,
          ruleId: "import-cycle",
          title: "Package import cycle",
          message: `Internal packages ${source} and ${dep} depend on each other.`,
          category: "architecture",
          severity: "error",
          confidence: "high",
          score: 85,
          packageName: source,
          filePath: pkg?.manifestPath ?? path.join(context.workspace.rootDir, "package.json"),
          startLine: 1,
          startColumn: 1,
          evidence: [source, dep],
          suggestion: "Break the cycle by moving shared types or helpers into a lower-level package.",
        });
      }
    }
  }
  return findings;
}

function findBoundaryViolations(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  if (context.config.boundaries.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  for (const sourceFile of sourceFiles) {
    const pkg = context.fileToPackage.get(sourceFile.getFilePath());
    if (!pkg) {
      continue;
    }
    const boundary = context.config.boundaries.find((item) => item.from === pkg.name);
    if (!boundary) {
      continue;
    }

    for (const imported of pkg.internalDependencies) {
      if (!boundary.allow.includes(imported)) {
        findings.push({
          id: `boundary-violation:${pkg.name}:${imported}`,
          ruleId: "boundary-violation",
          title: "Package boundary violation",
          message: `${pkg.name} depends on ${imported}, which is outside its allowed boundary.`,
          category: "architecture",
          severity: "error",
          confidence: "high",
          score: 90,
          packageName: pkg.name,
          filePath: sourceFile.getFilePath(),
          startLine: 1,
          startColumn: 1,
          evidence: [pkg.name, imported],
          suggestion: "Remove the import or move the shared code into an approved dependency boundary.",
        });
      }
    }
  }
  return findings;
}

function mapFilesToPackages(workspace: Workspace): Map<string, WorkspacePackage> {
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
