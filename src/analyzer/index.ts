import path from "node:path";
import { Project } from "ts-morph";
import { loadConfig } from "../config";
import { discoverWorkspace } from "../workspace";
import type {
  Finding,
  ScanOptions,
  ScanResult,
  ScanTriage,
  ScanTriageTheme,
  Severity,
  TriageLeadFinding,
  TriageQueueItem,
  TriageThemeId,
} from "../types";
import { analyzeModules, mapFilesToPackages, summarizePackageHotspots } from "./module-analysis";
import { runRules } from "./rules";
import { getAuthorSpreadMap, getChurnMap } from "../utils/git";
import { createTreeSitterParser } from "./parsers/tree-sitter-parser";
import { extractRustFunctions, extractRustImports } from "./extractors/rust";

const triageThemeDefinitions: Record<
  TriageThemeId,
  {
    title: string;
    description: string;
  }
> = {
  duplication: {
    title: "Duplicate code",
    description: "Consolidate repeated helpers and overlapping logic.",
  },
  complexity: {
    title: "Complex code",
    description: "Split deep or wide functions before they accrete more risk.",
  },
  architecture: {
    title: "Shared boundaries",
    description: "Reduce fan-in, import cycles, and cross-package blast radius.",
  },
  maintainability: {
    title: "Cleanup and APIs",
    description: "Tighten signatures and simplify routine cleanup work.",
  },
};

const triageThemeOrder: TriageThemeId[] = ["duplication", "complexity", "architecture", "maintainability"];
const startHereLimit = 5;

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const config = await loadConfig(options.cwd);
  const workspace = await discoverWorkspace(
    options.cwd,
    config,
    options.target,
    options.target.scope === "since" ? options.target.value : options.since,
  );

  // Separate TS/JS and Rust files
  const rustFilePaths = workspace.fileInventory.filter((f) => f.endsWith(".rs"));
  const tsFilePaths = workspace.fileInventory.filter((f) => !f.endsWith(".rs"));

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });

  for (const filePath of tsFilePaths) {
    project.addSourceFileAtPathIfExists(filePath);
  }

  const relativeFiles = workspace.fileInventory.map((file) => path.relative(workspace.rootDir, file));
  const churnByFile = config.analysis.includeGitChurn
    ? getChurnMap(workspace.rootDir, relativeFiles)
    : new Map<string, number>();
  const authorSpreadByFile = config.analysis.includeGitChurn
    ? getAuthorSpreadMap(workspace.rootDir, relativeFiles)
    : new Map<string, number>();

  // Process Rust files with tree-sitter
  const fileToPackage = mapFilesToPackages(workspace);
  let rustFunctions = undefined;
  let rustFileData = undefined;

  if (rustFilePaths.length > 0) {
    try {
      const tsParser = await createTreeSitterParser();
      rustFunctions = rustFilePaths.flatMap((filePath) => {
        const pkg = fileToPackage.get(filePath);
        return extractRustFunctions(filePath, pkg?.name, tsParser);
      });
      rustFileData = rustFilePaths.map((filePath) => {
        const pkg = fileToPackage.get(filePath);
        return {
          filePath,
          packageName: pkg?.name,
          imports: extractRustImports(filePath, tsParser),
        };
      });
    } catch (err) {
      // tree-sitter unavailable — skip Rust analysis gracefully
      process.stderr.write(
        `[wayweft] warning: Rust analysis skipped — tree-sitter failed to initialize: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const moduleAnalysis = analyzeModules({
    workspace,
    project,
    fileToPackage,
    churnByFile,
    ownershipByFile: authorSpreadByFile,
    rustFileData,
  });

  let findings = runRules(workspace, config, project, options.target, moduleAnalysis, churnByFile, rustFunctions);
  findings = findings.filter((finding) => finding.score >= (options.minScore ?? config.analysis.minScore));
  if (options.rule) {
    findings = findings.filter((finding) => finding.ruleId === options.rule);
  }
  if (options.maxFindings) {
    findings = findings.slice(0, options.maxFindings);
  }

  const findingsByPackage = new Map<string, number>();
  for (const finding of findings) {
    const key = finding.packageName ?? path.dirname(finding.filePath);
    findingsByPackage.set(key, (findingsByPackage.get(key) ?? 0) + 1);
  }

  return {
    workspace,
    findings,
    fileHotspots: moduleAnalysis.fileHotspots,
    packageHotspots: summarizePackageHotspots(moduleAnalysis.fileHotspots, findingsByPackage),
    triage: options.target.scope === "workspace" ? buildWorkspaceTriage(findings) : undefined,
    summary: {
      findingCount: findings.length,
      bySeverity: {
        info: findings.filter((finding) => finding.severity === "info").length,
        warning: findings.filter((finding) => finding.severity === "warning").length,
        error: findings.filter((finding) => finding.severity === "error").length,
      },
      maxScore: findings.reduce((max, finding) => Math.max(max, finding.score), 0),
    },
  };
}

function buildWorkspaceTriage(findings: Finding[]): ScanTriage {
  const findingsByTheme = new Map<TriageThemeId, Finding[]>();
  for (const themeId of triageThemeOrder) {
    findingsByTheme.set(themeId, []);
  }

  for (const finding of findings) {
    findingsByTheme.get(themeForFinding(finding))?.push(finding);
  }

  const themes = triageThemeOrder
    .flatMap((themeId): ScanTriageTheme[] => {
      const themeFindings = findingsByTheme.get(themeId) ?? [];
      if (themeFindings.length === 0) {
        return [];
      }

      const sortedFindings = [...themeFindings].sort(compareFindingPriority);
      return [
        {
          id: themeId,
          title: triageThemeDefinitions[themeId].title,
          description: triageThemeDefinitions[themeId].description,
          findingCount: sortedFindings.length,
          totalScore: sortedFindings.reduce((total, finding) => total + finding.score, 0),
          bySeverity: countSeverities(sortedFindings),
          leadFinding: toLeadFinding(sortedFindings[0]),
        },
      ];
    })
    .sort(compareThemeSummary);

  return {
    scope: "workspace",
    findingCount: findings.length,
    themeCount: themes.length,
    themes,
    startHere: buildStartHereQueue(findings, themes),
  };
}

function buildStartHereQueue(findings: Finding[], themes: ScanTriageTheme[]): TriageQueueItem[] {
  const queue: TriageQueueItem[] = [];
  const selected = new Set<string>();
  const sortedFindings = [...findings].sort(compareFindingPriority);

  for (const theme of themes) {
    if (queue.length >= startHereLimit) {
      break;
    }
    const item = toQueueItem(theme.leadFinding, theme, queue.length + 1);
    queue.push(item);
    selected.add(item.id);
  }

  for (const finding of sortedFindings) {
    if (queue.length >= startHereLimit) {
      break;
    }
    if (selected.has(finding.id)) {
      continue;
    }

    const themeId = themeForFinding(finding);
    const theme = themes.find((entry) => entry.id === themeId);
    if (!theme) {
      continue;
    }

    queue.push(toQueueItem(finding, theme, queue.length + 1));
    selected.add(finding.id);
  }

  return queue.slice(0, startHereLimit);
}

function toQueueItem(finding: TriageLeadFinding | Finding, theme: ScanTriageTheme, rank: number): TriageQueueItem {
  return {
    ...toLeadFinding(finding),
    rank,
    themeId: theme.id,
    themeTitle: theme.title,
    why: theme.description,
  };
}

function toLeadFinding(finding: TriageLeadFinding | Finding): TriageLeadFinding {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    title: finding.title,
    severity: finding.severity,
    score: finding.score,
    packageName: finding.packageName,
    filePath: finding.filePath,
    startLine: finding.startLine,
    startColumn: finding.startColumn,
  };
}

function themeForFinding(finding: Finding): TriageThemeId {
  switch (finding.category) {
    case "duplication":
      return "duplication";
    case "complexity":
      return "complexity";
    case "architecture":
      return "architecture";
    case "maintainability":
      return "maintainability";
    default: {
      const exhaustive: never = finding.category;
      return exhaustive;
    }
  }
}

function compareFindingPriority(left: Finding, right: Finding): number {
  return (
    right.score - left.score ||
    severityRank(right.severity) - severityRank(left.severity) ||
    confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.id.localeCompare(right.id)
  );
}

function compareThemeSummary(left: ScanTriageTheme, right: ScanTriageTheme): number {
  return (
    right.totalScore - left.totalScore ||
    right.findingCount - left.findingCount ||
    left.id.localeCompare(right.id)
  );
}

function countSeverities(findings: Finding[]): Record<Severity, number> {
  return {
    info: findings.filter((finding) => finding.severity === "info").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    error: findings.filter((finding) => finding.severity === "error").length,
  };
}

function severityRank(severity: Severity): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function confidenceRank(confidence: Finding["confidence"]): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}
