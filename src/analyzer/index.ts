import path from "node:path";
import { Project } from "ts-morph";
import { loadConfig } from "../config";
import { discoverWorkspace } from "../workspace";
import type { ScanOptions, ScanResult } from "../types";
import { analyzeModules, mapFilesToPackages, summarizePackageHotspots } from "./module-analysis";
import { runRules } from "./rules";
import { getAuthorSpreadMap, getChurnMap } from "../utils/git";

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const config = await loadConfig(options.cwd);
  const workspace = await discoverWorkspace(
    options.cwd,
    config,
    options.target,
    options.target.scope === "since" ? options.target.value : options.since,
  );

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
  });

  for (const filePath of workspace.fileInventory) {
    project.addSourceFileAtPathIfExists(filePath);
  }

  const relativeFiles = workspace.fileInventory.map((file) => path.relative(workspace.rootDir, file));
  const churnByFile = config.analysis.includeGitChurn
    ? getChurnMap(workspace.rootDir, relativeFiles)
    : new Map<string, number>();
  const authorSpreadByFile = config.analysis.includeGitChurn
    ? getAuthorSpreadMap(workspace.rootDir, relativeFiles)
    : new Map<string, number>();
  const moduleAnalysis = analyzeModules({
    workspace,
    project,
    fileToPackage: mapFilesToPackages(workspace),
    churnByFile,
    ownershipByFile: authorSpreadByFile,
  });

  let findings = runRules(workspace, config, project, options.target, moduleAnalysis, churnByFile);
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
