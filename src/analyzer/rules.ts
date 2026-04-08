import path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";
import type {
  Finding,
  FindingCategory,
  FunctionInfo,
  NormalizedConfig,
  NormalizedRuleConfig,
  ScanTarget,
  Workspace,
  WorkspacePackage,
} from "../types";
import { mapFilesToPackages, type ModuleGraphAnalysis } from "./module-analysis";
import { normalizePath } from "../utils/fs";

interface RuleContext {
  workspace: Workspace;
  config: NormalizedConfig;
  project: Project;
  target: ScanTarget;
  fileToPackage: Map<string, WorkspacePackage>;
  churnByFile: Map<string, number>;
  moduleAnalysis: ModuleGraphAnalysis;
}

interface LongFunctionContextTuning {
  labels: string[];
  maxLinesBonus: number;
}

export function runRules(
  workspace: Workspace,
  config: NormalizedConfig,
  project: Project,
  target: ScanTarget,
  moduleAnalysis: ModuleGraphAnalysis,
  churnByFile: Map<string, number>,
  rustFunctions?: FunctionInfo[],
): Finding[] {
  const fileToPackage = mapFilesToPackages(workspace);
  const context: RuleContext = {
    workspace,
    config,
    project,
    target,
    fileToPackage,
    churnByFile,
    moduleAnalysis,
  };
  const findings = [
    ...findFunctionComplexity(project.getSourceFiles(), context),
    ...findNearDuplicateFunctions(project.getSourceFiles(), context),
    ...findSafeRewriteOpportunities(project.getSourceFiles(), context),
    ...findCrossPackageDuplication(project.getSourceFiles(), context),
    ...findImportCycles(context),
    ...findBoundaryViolations(project.getSourceFiles(), context),
    ...findTestImpactHints(project.getSourceFiles(), context),
    ...findBlastRadiusHints(context),
    ...findChangeRiskFindings(context),
    ...findHotspotFindings(context),
    ...(rustFunctions ? findFunctionComplexityFromFunctionInfo(rustFunctions, workspace, config, churnByFile, fileToPackage) : []),
  ];
  return findings.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
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

function findTestImpactHints(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  if (
    !context.config.rules["test-impact-hint"]?.enabled ||
    context.workspace.changedFiles.length === 0 ||
    !["changed", "since"].includes(context.target.scope)
  ) {
    return [];
  }

  const findings: Finding[] = [];
  const testFiles = sourceFiles.filter((sourceFile) => isTestLikeFile(relativeToWorkspace(sourceFile.getFilePath(), context)));
  const changedSourceFiles = sourceFiles.filter((sourceFile) => {
    const filePath = sourceFile.getFilePath();
    return context.workspace.changedFiles.includes(filePath) && !isTestLikeFile(relativeToWorkspace(filePath, context));
  });

  const testsByKey = new Map<string, SourceFile[]>();
  const testsByBaseName = new Map<string, SourceFile[]>();
  for (const testFile of testFiles) {
    const testPath = relativeToWorkspace(testFile.getFilePath(), context);
    for (const key of buildTestLookupKeys(testPath)) {
      const bucket = testsByKey.get(key) ?? [];
      bucket.push(testFile);
      testsByKey.set(key, bucket);
    }

    const baseName = path.basename(stripTestSuffix(stripExtension(testPath)));
    const baseBucket = testsByBaseName.get(baseName) ?? [];
    baseBucket.push(testFile);
    testsByBaseName.set(baseName, baseBucket);
  }

  for (const sourceFile of changedSourceFiles) {
    const filePath = sourceFile.getFilePath();
    const relativePath = relativeToWorkspace(filePath, context);
    const pkg = context.fileToPackage.get(filePath);
    const candidates = findMatchingTests(relativePath, pkg?.name, testsByKey, testsByBaseName, context)
      .slice(0, 3);
    const location = sourceFile.getLineAndColumnAtPos(sourceFile.getStart());

    if (candidates.length === 0) {
      findings.push({
        id: `test-impact-hint:${relativePath}:missing`,
        ruleId: "test-impact-hint",
        title: "Changed source without nearby tests",
        message: `No nearby test files were matched for changed source ${relativePath}. This is a path-and-name heuristic, not proof of missing coverage.`,
        category: "maintainability",
        severity: "warning",
        confidence: "medium",
        score: 46,
        packageName: pkg?.name,
        filePath,
        startLine: location.line,
        startColumn: location.column,
        evidence: buildSourceLookupKeys(relativePath),
        suggestion: "Check whether this change should update an existing nearby test or add a focused new one.",
      });
      continue;
    }

    const relatedTests = candidates.map((candidate) => relativeToWorkspace(candidate.filePath, context));
    findings.push({
      id: `test-impact-hint:${relativePath}:related`,
      ruleId: "test-impact-hint",
      title: "Likely related tests for changed source",
      message: `Changed source ${relativePath} likely maps to ${relatedTests.join(", ")}. This is a heuristic hint based on file paths and naming conventions.`,
      category: "maintainability",
      severity: "info",
      confidence: "medium",
      score: 28,
      packageName: pkg?.name,
      filePath,
      startLine: location.line,
      startColumn: location.column,
      evidence: relatedTests,
      suggestion: "Run or inspect the matched tests first, then widen coverage if the change crosses module boundaries.",
    });
  }

  return findings;
}

interface DuplicateFunctionCandidate {
  filePath: string;
  relativePath: string;
  packageName?: string;
  sourceFile: SourceFile;
  symbolName: string;
  startLine: number;
  startColumn: number;
  normalizedBody: string;
  structuralFingerprint: string;
  statementShape: string;
  statementCount: number;
  bodyLength: number;
  contextKind: "production" | "test" | "setup";
}

function findNearDuplicateFunctions(sourceFiles: SourceFile[], context: RuleContext): Finding[] {
  if (!context.config.rules["near-duplicate-function"]?.enabled) {
    return [];
  }

  const findings: Finding[] = [];
  const candidatesByPackage = new Map<string, DuplicateFunctionCandidate[]>();

  for (const sourceFile of sourceFiles) {
    const pkg = context.fileToPackage.get(sourceFile.getFilePath());
    const packageName = pkg?.name ?? "__workspace__";
    const bucket = candidatesByPackage.get(packageName) ?? [];
    for (const candidate of collectDuplicateCandidates(sourceFile, context)) {
      bucket.push(candidate);
    }
    candidatesByPackage.set(packageName, bucket);
  }

  for (const [packageName, candidates] of candidatesByPackage.entries()) {
    const candidateBuckets = new Map<string, DuplicateFunctionCandidate[]>();
    const sortedCandidates = [...candidates].sort(compareDuplicateCandidates);
    for (const candidate of sortedCandidates) {
      const key = `${candidate.statementShape}:${candidate.statementCount}:${Math.round(candidate.bodyLength / 60)}`;
      const bucket = candidateBuckets.get(key) ?? [];
      bucket.push(candidate);
      candidateBuckets.set(key, bucket);
    }

    for (const bucket of candidateBuckets.values()) {
      if (bucket.length < 2) {
        continue;
      }
      const adjacency = new Map<number, Array<{ index: number; similarity: number }>>();
      for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
          const left = bucket[leftIndex];
          const right = bucket[rightIndex];
          if (left.filePath === right.filePath && left.symbolName === right.symbolName) {
            continue;
          }

          const similarity = getDuplicateSimilarity(left, right);
          if (similarity < 0.88) {
            continue;
          }

          const leftNeighbors = adjacency.get(leftIndex) ?? [];
          leftNeighbors.push({ index: rightIndex, similarity });
          adjacency.set(leftIndex, leftNeighbors);

          const rightNeighbors = adjacency.get(rightIndex) ?? [];
          rightNeighbors.push({ index: leftIndex, similarity });
          adjacency.set(rightIndex, rightNeighbors);
        }
      }

      const visited = new Set<number>();
      for (let index = 0; index < bucket.length; index += 1) {
        if (visited.has(index) || !adjacency.has(index)) {
          continue;
        }

        const stack = [index];
        const componentIndices: number[] = [];
        visited.add(index);

        while (stack.length > 0) {
          const current = stack.pop()!;
          componentIndices.push(current);
          for (const neighbor of adjacency.get(current) ?? []) {
            if (visited.has(neighbor.index)) {
              continue;
            }
            visited.add(neighbor.index);
            stack.push(neighbor.index);
          }
        }

        if (componentIndices.length < 2) {
          continue;
        }

        const component = componentIndices.map((componentIndex) => bucket[componentIndex]).sort(compareDuplicateCandidates);
        const productionMembers = component.filter((candidate) => candidate.contextKind === "production");
        if (productionMembers.length < 2) {
          continue;
        }

        const reportablePair = findStrongestDuplicatePair(productionMembers);
        if (!reportablePair || reportablePair.similarity < 0.88) {
          continue;
        }

        const bestSimilarity = reportablePair.similarity;
        const noisyMembers = component.length - productionMembers.length;
        const representative = productionMembers[0];
        const familySize = productionMembers.length;
        findings.push({
          id: `near-duplicate-function:${packageName}:${component.map((candidate) => formatDuplicateCandidate(candidate)).join("|")}`,
          ruleId: "near-duplicate-function",
          title: "Near-duplicate function family",
          message:
            noisyMembers > 0
              ? `${familySize} production function${familySize === 1 ? "" : "s"} form a near-duplicate family; ${noisyMembers} test/setup helper${noisyMembers === 1 ? "" : "s"} also matched.`
              : `${familySize} function${familySize === 1 ? "" : "s"} form a near-duplicate family.`,
          category: "duplication",
          severity: bestSimilarity >= 0.94 || familySize >= 3 ? "warning" : "info",
          confidence: bestSimilarity >= 0.94 || familySize >= 3 ? "high" : "medium",
          score: Math.min(
            100,
            Math.round(
              38 +
                bestSimilarity * 34 +
                familySize * 6 +
                Math.min(12, representative.statementCount * 2) -
                noisyMembers * 4,
            ),
          ),
          packageName: packageName === "__workspace__" ? undefined : packageName,
          filePath: representative.filePath,
          startLine: representative.startLine,
          startColumn: representative.startColumn,
          symbolName: representative.symbolName,
          evidence: buildDuplicateFamilyEvidence(component, productionMembers, reportablePair, bestSimilarity),
          suggestion: "Consolidate the shared control flow into one helper, then keep only the truly different logic at the call sites.",
        });
      }
    }
  }

  return findings;
}

function collectDuplicateCandidates(sourceFile: SourceFile, context: RuleContext): DuplicateFunctionCandidate[] {
  const candidates: DuplicateFunctionCandidate[] = [];
  const filePath = sourceFile.getFilePath();
  const relativePath = relativeToWorkspace(filePath, context);
  const packageName = context.fileToPackage.get(filePath)?.name;
  const contextKind = getDuplicateCandidateContext(relativePath);

  const pushCandidate = (
    fn: FunctionDeclaration | MethodDeclaration | ArrowFunction,
    symbolName: string,
  ) => {
    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) {
      return;
    }
    const statementCount = body.getStatements().length;
    const bodyText = body.getText().replace(/\s+/g, " ").trim();
    const minStatements = contextKind === "production" ? 3 : 4;
    const minBodyLength = contextKind === "production" ? 80 : 120;
    if (statementCount < minStatements || bodyText.length < minBodyLength) {
      return;
    }
    const location = sourceFile.getLineAndColumnAtPos(fn.getStart());
    candidates.push({
      filePath,
      relativePath,
      packageName,
      sourceFile,
      symbolName,
      startLine: location.line,
      startColumn: location.column,
      normalizedBody: normalizeFunctionBody(body),
      structuralFingerprint: structuralFingerprint(body),
      statementShape: body.getStatements().map((statement) => SyntaxKind[statement.getKind()]).join(">"),
      statementCount,
      bodyLength: bodyText.length,
      contextKind,
    });
  };

  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    pushCandidate(fn, fn.getName() ?? "<anonymous>");
  }
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
    pushCandidate(fn, fn.getName() ?? "<anonymous>");
  }
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
    const variable = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    pushCandidate(fn, variable?.getName() ?? "<anonymous>");
  }

  return candidates;
}

function getDuplicateCandidateContext(relativePath: string): "production" | "test" | "setup" {
  if (isTestLikeFile(relativePath)) {
    return "test";
  }
  if (isSetupLikeFile(relativePath)) {
    return "setup";
  }
  return "production";
}

function isSetupLikeFile(relativePath: string): boolean {
  return /(?:^|\/)[^/]+\.(?:config|setup)\.[cm]?[jt]sx?$/.test(relativePath);
}

function compareDuplicateCandidates(left: DuplicateFunctionCandidate, right: DuplicateFunctionCandidate): number {
  return (
    left.relativePath.localeCompare(right.relativePath) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    left.symbolName.localeCompare(right.symbolName)
  );
}

function getDuplicateSimilarity(left: DuplicateFunctionCandidate, right: DuplicateFunctionCandidate): number {
  const normalizedSimilarity = similarityRatio(left.normalizedBody, right.normalizedBody);
  const structuralSimilarity = similarityRatio(left.structuralFingerprint, right.structuralFingerprint);
  const statementSimilarity = similarityRatio(left.statementShape, right.statementShape);
  return (normalizedSimilarity * 0.5) + (structuralSimilarity * 0.35) + (statementSimilarity * 0.15);
}

function findStrongestDuplicatePair(candidates: DuplicateFunctionCandidate[]): {
  left: DuplicateFunctionCandidate;
  right: DuplicateFunctionCandidate;
  similarity: number;
  normalizedSimilarity: number;
  structuralSimilarity: number;
  statementSimilarity: number;
} | null {
  let bestPair: {
    left: DuplicateFunctionCandidate;
    right: DuplicateFunctionCandidate;
    similarity: number;
    normalizedSimilarity: number;
    structuralSimilarity: number;
    statementSimilarity: number;
  } | null = null;

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      const normalizedSimilarity = similarityRatio(left.normalizedBody, right.normalizedBody);
      const structuralSimilarity = similarityRatio(left.structuralFingerprint, right.structuralFingerprint);
      const statementSimilarity = similarityRatio(left.statementShape, right.statementShape);
      const similarity = (normalizedSimilarity * 0.5) + (structuralSimilarity * 0.35) + (statementSimilarity * 0.15);
      if (
        !bestPair ||
        similarity > bestPair.similarity ||
        (similarity === bestPair.similarity && compareDuplicateCandidates(left, bestPair.left) < 0)
      ) {
        bestPair = {
          left,
          right,
          similarity,
          normalizedSimilarity,
          structuralSimilarity,
          statementSimilarity,
        };
      }
    }
  }

  return bestPair;
}

function buildDuplicateFamilyEvidence(
  component: DuplicateFunctionCandidate[],
  productionMembers: DuplicateFunctionCandidate[],
  bestPair: {
    left: DuplicateFunctionCandidate;
    right: DuplicateFunctionCandidate;
    similarity: number;
    normalizedSimilarity: number;
    structuralSimilarity: number;
    statementSimilarity: number;
  },
  bestSimilarity: number,
): string[] {
  const evidence = [
    `family-size=${productionMembers.length}`,
    `cluster-size=${component.length}`,
    `best-similarity=${Math.round(bestSimilarity * 100)}%`,
    `best-pair=${formatDuplicateCandidate(bestPair.left)} <-> ${formatDuplicateCandidate(bestPair.right)}`,
    `normalized=${Math.round(bestPair.normalizedSimilarity * 100)}%`,
    `structural=${Math.round(bestPair.structuralSimilarity * 100)}%`,
    `statements=${bestPair.left.statementCount}/${bestPair.right.statementCount}`,
  ];

  const noisyMembers = component.filter((candidate) => candidate.contextKind !== "production");
  if (noisyMembers.length > 0) {
    evidence.push(`noisy-members=${noisyMembers.length}`);
  }

  for (const candidate of component) {
    evidence.push(`member=${formatDuplicateCandidate(candidate)}`);
  }

  return evidence;
}

function formatDuplicateCandidate(candidate: DuplicateFunctionCandidate): string {
  const suffix = candidate.contextKind === "production" ? "" : ` [${candidate.contextKind}]`;
  return `${candidate.relativePath}:${candidate.startLine}:${candidate.symbolName}${suffix}`;
}

function normalizeFunctionBody(node: Node): string {
  return node
    .getText()
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '"$STR"')
    .replace(/\b\d+(?:\.\d+)?\b/g, "$NUM")
    .replace(/\b[_$a-zA-Z][_$a-zA-Z0-9]*\b/g, (token) => {
      if (["return", "if", "else", "switch", "case", "for", "while", "const", "let", "var", "function", "await", "async", "new", "throw", "try", "catch"].includes(token)) {
        return token;
      }
      return "$ID";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function structuralFingerprint(node: Node): string {
  return node
    .getDescendants()
    .filter((descendant) =>
      ![
        SyntaxKind.Identifier,
        SyntaxKind.StringLiteral,
        SyntaxKind.NumericLiteral,
        SyntaxKind.NoSubstitutionTemplateLiteral,
      ].includes(descendant.getKind()),
    )
    .map((descendant) => SyntaxKind[descendant.getKind()])
    .join(">");
}

function similarityRatio(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const leftTokens = left.split(/[^A-Za-z0-9$]+/).filter(Boolean);
  const rightTokens = right.split(/[^A-Za-z0-9$]+/).filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function findBlastRadiusHints(context: RuleContext): Finding[] {
  if (!["changed", "since"].includes(context.target.scope) || context.workspace.changedFiles.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  for (const filePath of context.workspace.changedFiles) {
    const node = context.moduleAnalysis.nodes.get(filePath);
    if (!node || node.blastRadius === 0) {
      continue;
    }

    const location = firstFileLocation(context.project, filePath);
    const dependents = node.importedBy
      .map((dependent) => relativeToWorkspace(dependent, context))
      .slice(0, 3);
    findings.push({
      id: `blast-radius:${node.relativePath}`,
      ruleId: "blast-radius",
      title: "Changed module has graph-backed blast radius",
      message: `${node.relativePath} can affect ${node.blastRadius} downstream module${node.blastRadius === 1 ? "" : "s"} through local imports.`,
      category: "architecture",
      severity: node.blastRadius >= 4 ? "warning" : "info",
      confidence: "high",
      score: Math.min(100, 28 + node.blastRadius * 9 + node.fanIn * 4),
      packageName: node.packageName,
      filePath,
      startLine: location.line,
      startColumn: location.column,
      evidence: [
        `fanIn=${node.fanIn}`,
        `fanOut=${node.fanOut}`,
        `componentSize=${node.componentSize}`,
        ...dependents,
      ],
      suggestion: "Review direct dependents first and widen validation if this module sits on a shared path.",
    });
  }
  return findings;
}

function findChangeRiskFindings(context: RuleContext): Finding[] {
  if (!["changed", "since"].includes(context.target.scope) || context.workspace.changedFiles.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  for (const filePath of context.workspace.changedFiles) {
    const node = context.moduleAnalysis.nodes.get(filePath);
    if (!node) {
      continue;
    }

    const riskSignals = new Set<string>();
    const relativePath = node.relativePath;
    if (/(^|\/)(auth|billing|payment|route|router|config)(\/|\.|$)/i.test(relativePath)) {
      riskSignals.add("sensitive-path");
    }
    if (/(^|\/)(shared|common|utils?|helpers?)(\/|\.|$)/i.test(relativePath)) {
      riskSignals.add("shared-utility-path");
    }
    if (node.fanIn >= 2) {
      riskSignals.add(`fan-in=${node.fanIn}`);
    }
    if (node.blastRadius >= 3) {
      riskSignals.add(`blast-radius=${node.blastRadius}`);
    }

    if (riskSignals.size === 0) {
      continue;
    }

    const location = firstFileLocation(context.project, filePath);
    const structuralRisk = (riskSignals.has("sensitive-path") ? 22 : 0) +
      (riskSignals.has("shared-utility-path") ? 12 : 0) +
      Math.min(24, node.fanIn * 6) +
      Math.min(18, node.blastRadius * 3);

    findings.push({
      id: `change-risk:${relativePath}`,
      ruleId: "change-risk",
      title: "Changed file merits extra review",
      message: `${relativePath} matches advisory change-risk heuristics: ${[...riskSignals].join(", ")}.`,
      category: "maintainability",
      severity: structuralRisk >= 45 ? "warning" : "info",
      confidence: "medium",
      score: Math.min(100, 24 + structuralRisk),
      packageName: node.packageName,
      filePath,
      startLine: location.line,
      startColumn: location.column,
      evidence: [...riskSignals],
      suggestion: "Inspect call sites, config paths, and nearby tests before treating this as a routine low-risk edit.",
    });
  }
  return findings;
}

function findHotspotFindings(context: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const hotspot of context.moduleAnalysis.fileHotspots) {
    const seamHints = hotspot.seamHints ?? [];
    const minimumScore = seamHints.length > 0 ? 35 : 45;
    if (hotspot.score < minimumScore) {
      continue;
    }
    const location = firstFileLocation(context.project, hotspot.filePath);
    const primaryHint = seamHints[0];
    findings.push({
      id: `hotspot-score:${normalizePath(path.relative(context.workspace.rootDir, hotspot.filePath))}`,
      ruleId: "hotspot-score",
      title: "Multi-signal hotspot",
      message: primaryHint
        ? `${relativeToWorkspace(hotspot.filePath, context)} ranks as a hotspot with combined signals from ${hotspot.topSignals.join(", ")}. Start by extracting ${primaryHint}.`
        : `${relativeToWorkspace(hotspot.filePath, context)} ranks as a hotspot with combined signals from ${hotspot.topSignals.join(", ")}.`,
      category: "architecture",
      severity: hotspot.score >= 70 ? "warning" : "info",
      confidence: "medium",
      score: hotspot.score,
      packageName: hotspot.packageName,
      filePath: hotspot.filePath,
      startLine: location.line,
      startColumn: location.column,
      evidence: [
        ...Object.entries(hotspot.signals).map(([signal, value]) => `${signal}=${value ?? 0}`),
        ...seamHints.map((hint) => `seam=${hint}`),
      ],
      suggestion: primaryHint
        ? `Start by extracting ${primaryHint}, then use the signal breakdown to decide what else to split, stabilize, or cover.`
        : "Use the signal breakdown to decide whether to split, stabilize, or add coverage instead of treating raw size as the main signal.",
    });
  }
  return findings;
}

function firstFileLocation(project: Project, filePath: string): { line: number; column: number } {
  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    return { line: 1, column: 1 };
  }
  return sourceFile.getLineAndColumnAtPos(sourceFile.getStart());
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

function findMatchingTests(
  relativePath: string,
  packageName: string | undefined,
  testsByKey: Map<string, SourceFile[]>,
  testsByBaseName: Map<string, SourceFile[]>,
  context: RuleContext,
): Array<{ filePath: string; score: number }> {
  const scored = new Map<string, number>();
  const preferredKeys = buildSourceLookupKeys(relativePath);

  for (const key of preferredKeys) {
    for (const testFile of testsByKey.get(key) ?? []) {
      const score = key.includes("/") ? 5 : 4;
      pushTestCandidate(scored, testFile.getFilePath(), score);
    }
  }

  const baseName = path.basename(stripExtension(relativePath));
  for (const testFile of testsByBaseName.get(baseName) ?? []) {
    const samePackage = context.fileToPackage.get(testFile.getFilePath())?.name === packageName;
    pushTestCandidate(scored, testFile.getFilePath(), samePackage ? 3 : 1);
  }

  return [...scored.entries()]
    .map(([filePath, score]) => ({ filePath, score }))
    .filter((entry) => entry.score >= 3)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
}

function pushTestCandidate(scored: Map<string, number>, filePath: string, score: number): void {
  const existing = scored.get(filePath) ?? 0;
  if (score > existing) {
    scored.set(filePath, score);
  }
}

function buildTestLookupKeys(relativePath: string): string[] {
  const withoutExtension = stripExtension(relativePath);
  const strippedTestPath = stripTestContainers(stripTestSuffix(withoutExtension));
  const keys = new Set<string>([strippedTestPath, path.basename(strippedTestPath)]);
  if (strippedTestPath.endsWith("/index")) {
    keys.add(strippedTestPath.slice(0, -"/index".length));
  }
  return [...keys];
}

function buildSourceLookupKeys(relativePath: string): string[] {
  const withoutExtension = stripExtension(relativePath);
  const strippedSourcePath = stripSourceContainers(withoutExtension);
  const keys = new Set<string>([strippedSourcePath, path.basename(strippedSourcePath)]);
  if (strippedSourcePath.endsWith("/index")) {
    keys.add(strippedSourcePath.slice(0, -"/index".length));
  }
  return [...keys];
}

function stripExtension(relativePath: string): string {
  return relativePath.replace(/\.[^.]+$/, "");
}

function stripTestSuffix(relativePath: string): string {
  return relativePath.replace(/\.(?:test|spec)$/, "");
}

function stripSourceContainers(relativePath: string): string {
  return relativePath.replace(/(^|\/)(?:src|lib|app)\//g, "$1");
}

function stripTestContainers(relativePath: string): string {
  return relativePath.replace(/(^|\/)(?:__tests__|tests|test)\//g, "$1");
}

function relativeToWorkspace(filePath: string, context: RuleContext): string {
  return normalizePath(path.relative(context.workspace.rootDir, filePath));
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

function findFunctionComplexityFromFunctionInfo(
  functions: FunctionInfo[],
  workspace: Workspace,
  config: NormalizedConfig,
  churnByFile: Map<string, number>,
  fileToPackage: Map<string, WorkspacePackage>,
): Finding[] {
  const findings: Finding[] = [];

  for (const fn of functions) {
    const pkg = fileToPackage.get(fn.filePath);
    const packageName = fn.packageName ?? pkg?.name;
    const relativePath = normalizePath(path.relative(workspace.rootDir, fn.filePath));
    const churn = churnByFile.get(relativePath) ?? 0;
    const internalDepsBonus = pkg && pkg.internalDependencies.length > 0 ? 5 : 0;

    const packageRules = (() => {
      if (!pkg) return config.rules;
      const override = config.packages[pkg.name]?.rules ?? {};
      const merged = { ...config.rules };
      for (const [ruleId, value] of Object.entries(override)) {
        merged[ruleId] = {
          enabled: value.enabled ?? merged[ruleId]?.enabled ?? true,
          maxLines: value.maxLines ?? merged[ruleId]?.maxLines ?? 45,
          maxDepth: value.maxDepth ?? merged[ruleId]?.maxDepth ?? 3,
          maxParams: value.maxParams ?? merged[ruleId]?.maxParams ?? 4,
        };
      }
      return merged;
    })();

    const makeId = (ruleId: string) =>
      `${ruleId}:${relativePath}:${fn.startLine}:${fn.name}`;
    const makeScore = (structural: number) =>
      Math.min(100, Math.round(structural + Math.min(20, churn) + internalDepsBonus));
    const makeSeverity = (score: number) =>
      score >= 75 ? ("error" as const) : score >= 40 ? ("warning" as const) : ("info" as const);

    if (
      packageRules["long-function"]?.enabled &&
      fn.lineCount > packageRules["long-function"].maxLines
    ) {
      const structural = Math.min(40, fn.lineCount - packageRules["long-function"].maxLines + 20);
      const score = makeScore(structural);
      findings.push({
        id: makeId("long-function"),
        ruleId: "long-function",
        title: "Long function",
        message: `Function spans ${fn.lineCount} lines and exceeds the configured threshold of ${packageRules["long-function"].maxLines}.`,
        category: "complexity",
        severity: makeSeverity(score),
        confidence: "high",
        score,
        packageName,
        filePath: fn.filePath,
        startLine: fn.startLine,
        startColumn: fn.startColumn,
        endLine: fn.endLine,
        endColumn: 1,
        symbolName: fn.name,
        evidence: [
          `lines=${fn.lineCount}`,
          `threshold=${packageRules["long-function"].maxLines}`,
          `branches=${fn.branchCount}`,
          `depth=${fn.maxNestingDepth}`,
          `language=rust`,
        ],
        suggestion: "Split the function into smaller units with one control-flow concern each.",
      });
    }

    if (
      packageRules["deep-nesting"]?.enabled &&
      fn.maxNestingDepth > packageRules["deep-nesting"].maxDepth
    ) {
      const structural = 25 + fn.maxNestingDepth * 4;
      const score = makeScore(structural);
      findings.push({
        id: makeId("deep-nesting"),
        ruleId: "deep-nesting",
        title: "Deep nesting",
        message: `Function reaches nesting depth ${fn.maxNestingDepth}, above ${packageRules["deep-nesting"].maxDepth}.`,
        category: "complexity",
        severity: makeSeverity(score),
        confidence: "high",
        score,
        packageName,
        filePath: fn.filePath,
        startLine: fn.startLine,
        startColumn: fn.startColumn,
        endLine: fn.endLine,
        endColumn: 1,
        symbolName: fn.name,
        evidence: [`depth=${fn.maxNestingDepth}`, `branches=${fn.branchCount}`, `language=rust`],
        suggestion: "Flatten guard clauses and extract inner branches into helper functions.",
      });
    }

    if (
      packageRules["too-many-params"]?.enabled &&
      fn.parameterCount > packageRules["too-many-params"].maxParams
    ) {
      const structural = 24 + fn.parameterCount * 5;
      const score = makeScore(structural);
      findings.push({
        id: makeId("too-many-params"),
        ruleId: "too-many-params",
        title: "Too many parameters",
        message: `Function accepts ${fn.parameterCount} parameters, above ${packageRules["too-many-params"].maxParams}.`,
        category: "maintainability",
        severity: makeSeverity(score),
        confidence: "high",
        score,
        packageName,
        filePath: fn.filePath,
        startLine: fn.startLine,
        startColumn: fn.startColumn,
        endLine: fn.endLine,
        endColumn: 1,
        symbolName: fn.name,
        evidence: [...fn.parameterNames.filter((n) => n !== "self"), `language=rust`],
        suggestion: "Introduce a parameter object or split the responsibility across multiple helpers.",
      });
    }

    if (packageRules["boolean-param"]?.enabled && fn.hasBooleanParams) {
      const structural = 30 + fn.booleanParamNames.length * 8;
      const score = makeScore(structural);
      findings.push({
        id: makeId("boolean-param"),
        ruleId: "boolean-param",
        title: "Boolean flag parameter",
        message: `Function exposes boolean flags (${fn.booleanParamNames.join(", ")}) that likely encode multiple behaviors.`,
        category: "maintainability",
        severity: makeSeverity(score),
        confidence: "high",
        score,
        packageName,
        filePath: fn.filePath,
        startLine: fn.startLine,
        startColumn: fn.startColumn,
        endLine: fn.endLine,
        endColumn: 1,
        symbolName: fn.name,
        evidence: [...fn.booleanParamNames, `language=rust`],
        suggestion: "Split the call path into separate named functions or use an enum-like option.",
      });
    }
  }

  return findings;
}
