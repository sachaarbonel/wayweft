import path from "node:path";
import pc from "picocolors";
import type { Finding, ScanResult } from "../types";

export function formatTextReport(result: ScanResult): string {
  const lines = [
    pc.bold(`Wayweft: ${result.summary.findingCount} findings`),
    `Errors: ${result.summary.bySeverity.error}  Warnings: ${result.summary.bySeverity.warning}  Info: ${result.summary.bySeverity.info}`,
    "",
  ];

  for (const finding of result.findings) {
    const relative = path.relative(result.workspace.rootDir, finding.filePath) || finding.filePath;
    lines.push(
      `${badge(finding.severity)} [${finding.score}] ${finding.title} (${finding.ruleId})`,
      `  ${relative}:${finding.startLine}:${finding.startColumn}`,
      `  ${finding.message}`,
      finding.suggestion ? `  Suggestion: ${finding.suggestion}` : "",
      "",
    );
  }

  if (result.fileHotspots.length > 0) {
    lines.push("Top hotspot files:");
    for (const hotspot of result.fileHotspots) {
      lines.push(
        `  - ${path.relative(result.workspace.rootDir, hotspot.filePath)}: score ${hotspot.score} (${hotspot.topSignals.join(", ") || "weak-signal mix"})`,
      );
    }
    lines.push("");
  }

  if (result.packageHotspots.length > 0) {
    lines.push("Top hotspot packages:");
    for (const hotspot of result.packageHotspots) {
      lines.push(
        `  - ${hotspot.packageName}: score ${hotspot.totalScore}, avg ${hotspot.averageScore ?? 0}, findings ${hotspot.findingCount}${hotspot.topSignals?.length ? ` (${hotspot.topSignals.join(", ")})` : ""}`,
      );
    }
  }

  return lines.filter(Boolean).join("\n");
}

export function formatMarkdownReport(result: ScanResult): string {
  const rows = result.findings
    .map(
      (finding) =>
        `| ${finding.severity} | ${finding.score} | ${finding.ruleId} | ${finding.packageName ?? "-"} | ${path.relative(result.workspace.rootDir, finding.filePath)}:${finding.startLine} | ${escapePipe(finding.message)} |`,
    )
    .join("\n");

  const hotspots = result.packageHotspots
    .map((hotspot) => `- ${hotspot.packageName}: ${hotspot.findingCount} findings, score ${hotspot.totalScore}`)
    .join("\n");

  return [
    "# Wayweft Report",
    "",
    `- Findings: ${result.summary.findingCount}`,
    `- Errors: ${result.summary.bySeverity.error}`,
    `- Warnings: ${result.summary.bySeverity.warning}`,
    `- Info: ${result.summary.bySeverity.info}`,
    "",
    "## Findings",
    "",
    "| Severity | Score | Rule | Package | Location | Message |",
    "| --- | ---: | --- | --- | --- | --- |",
    rows || "| - | - | - | - | - | No findings |",
    "",
    "## File Hotspots",
    "",
    result.fileHotspots
      .map((hotspot) =>
        `- ${path.relative(result.workspace.rootDir, hotspot.filePath)}: score ${hotspot.score} (${hotspot.topSignals.join(", ") || "weak-signal mix"})`,
      )
      .join("\n") || "- None",
    "",
    "## Package Hotspots",
    "",
    hotspots || "- None",
    "",
  ].join("\n");
}

export function formatJsonReport(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatSarifReport(result: ScanResult): string {
  return JSON.stringify(
    {
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "wayweft",
              rules: uniqueRules(result.findings).map((ruleId) => ({
                id: ruleId,
                shortDescription: {
                  text: ruleId,
                },
              })),
            },
          },
          results: result.findings.map((finding) => ({
            ruleId: finding.ruleId,
            level: finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "note",
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: {
                    uri: path.relative(result.workspace.rootDir, finding.filePath),
                  },
                  region: {
                    startLine: finding.startLine,
                    startColumn: finding.startColumn,
                    endLine: finding.endLine,
                    endColumn: finding.endColumn,
                  },
                },
              },
            ],
            properties: {
              score: finding.score,
              confidence: finding.confidence,
              packageName: finding.packageName,
            },
          })),
        },
      ],
    },
    null,
    2,
  );
}

function uniqueRules(findings: Finding[]): string[] {
  return [...new Set(findings.map((finding) => finding.ruleId))];
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function badge(severity: Finding["severity"]): string {
  if (severity === "error") {
    return pc.red("error");
  }
  if (severity === "warning") {
    return pc.yellow("warn ");
  }
  return pc.cyan("info ");
}
