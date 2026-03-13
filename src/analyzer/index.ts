import path from "node:path";
import { Project } from "ts-morph";
import { loadConfig } from "../config.js";
import { discoverWorkspace, matchesIgnore } from "../workspace.js";
import type { Finding, ScanOptions, ScanResult } from "../types.js";
import { runRules } from "./rules.js";

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
    if (!matchesIgnore(filePath, workspace.rootDir, config.ignore)) {
      project.addSourceFileAtPathIfExists(filePath);
    }
  }

  let findings = runRules(workspace, config, project);
  findings = findings.filter((finding) => finding.score >= (options.minScore ?? config.analysis.minScore));
  if (options.rule) {
    findings = findings.filter((finding) => finding.ruleId === options.rule);
  }
  if (options.maxFindings) {
    findings = findings.slice(0, options.maxFindings);
  }

  return {
    workspace,
    findings,
    packageHotspots: buildHotspots(findings),
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

function buildHotspots(findings: Finding[]) {
  const scores = new Map<string, { totalScore: number; findingCount: number }>();
  for (const finding of findings) {
    const key = finding.packageName ?? path.dirname(finding.filePath);
    const entry = scores.get(key) ?? { totalScore: 0, findingCount: 0 };
    entry.totalScore += finding.score;
    entry.findingCount += 1;
    scores.set(key, entry);
  }
  return [...scores.entries()]
    .map(([packageName, value]) => ({
      packageName,
      totalScore: value.totalScore,
      findingCount: value.findingCount,
    }))
    .sort((left, right) => right.totalScore - left.totalScore)
    .slice(0, 10);
}
