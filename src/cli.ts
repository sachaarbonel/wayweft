#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatJsonReport, formatMarkdownReport, formatSarifReport, formatTextReport } from "./reporters/index.js";
import { applySafeFixes } from "./fixes/index.js";
import { installSkillBundles } from "./skills/index.js";
import { scanWorkspace } from "./analyzer/index.js";
import { defineConfig } from "./config.js";

type Format = "text" | "json" | "sarif" | "markdown";

async function main() {
  const [command = "scan", ...args] = process.argv.slice(2);
  const parsed = parseArgs(args);

  switch (command) {
    case "scan":
      await runScan(parsed);
      break;
    case "report":
      await runScan(parsed);
      break;
    case "fix":
      await runFix(parsed);
      break;
    case "init":
      runInit(process.cwd());
      break;
    case "skill":
      if (args[0] === "install") {
        await runSkillInstall(process.cwd());
        break;
      }
      throw new Error("Unsupported skill subcommand.");
    case "doctor":
      await runDoctor(process.cwd());
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runScan(parsed: ParsedArgs) {
  const result = await scanWorkspace({
    cwd: process.cwd(),
    target: parseScope(parsed.scope, parsed.since),
    changedOnly: parsed.changedOnly,
    since: parsed.since,
    maxFindings: parsed.maxFindings,
    minScore: parsed.minScore,
    rule: parsed.rule,
  });

  const rendered = formatResult(result, parsed.format);
  if (parsed.output) {
    mkdirSync(path.dirname(parsed.output), { recursive: true });
    writeFileSync(parsed.output, rendered, "utf8");
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

async function runFix(parsed: ParsedArgs) {
  const result = await scanWorkspace({
    cwd: process.cwd(),
    target: parseScope(parsed.scope, parsed.since),
    since: parsed.since,
    minScore: parsed.minScore,
    rule: parsed.rule,
  });
  const selected = parsed.rule
    ? result.findings.filter((finding) => finding.ruleId === parsed.rule)
    : result.findings;
  const fixResult = applySafeFixes(selected, Boolean(parsed.apply && !parsed.dryRun));
  process.stdout.write(`${fixResult.preview}\n`);
}

function runInit(cwd: string) {
  const configPath = path.join(cwd, "refactor-scout.config.ts");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      `import { defineConfig } from "refactor-scout";

export default defineConfig({
  workspace: {
    rootMarkers: ["pnpm-workspace.yaml", "turbo.json", "nx.json", "package.json", ".git"],
    packageGlobs: ["apps/*", "packages/*", "services/*"],
  },
  analysis: {
    minScore: 25,
    changedOnlyDefault: false,
    includeGitChurn: true,
  },
  rules: {
    "long-function": { maxLines: 45 },
    "deep-nesting": { maxDepth: 3 },
    "too-many-params": { maxParams: 4 },
    "boolean-param": { enabled: true },
    "cross-package-duplication": { enabled: true },
  },
  ignore: ["**/dist/**", "**/coverage/**", "**/*.generated.*", "**/__snapshots__/**"],
});
`,
      "utf8",
    );
  }
  installSkillBundles({ rootDir: cwd });
  process.stdout.write("Initialized refactor-scout config and skill bundles.\n");
}

async function runSkillInstall(cwd: string) {
  const result = await scanWorkspace({
    cwd,
    target: { scope: "workspace" },
  });
  const written = installSkillBundles({
    rootDir: result.workspace.rootDir,
    packageDirs: result.workspace.packages.map((pkg) => pkg.dir),
  });
  process.stdout.write(`Installed skill bundles:\n${written.map((item) => `- ${item}`).join("\n")}\n`);
}

async function runDoctor(cwd: string) {
  const result = await scanWorkspace({
    cwd,
    target: { scope: "workspace" },
    maxFindings: 1,
  });
  process.stdout.write(
    [
      `Workspace root: ${result.workspace.rootDir}`,
      `Packages: ${result.workspace.packages.length}`,
      `Files: ${result.workspace.fileInventory.length}`,
      "Doctor checks: ok",
    ].join("\n") + "\n",
  );
}

function formatResult(result: Awaited<ReturnType<typeof scanWorkspace>>, format: Format): string {
  switch (format) {
    case "json":
      return formatJsonReport(result);
    case "markdown":
      return formatMarkdownReport(result);
    case "sarif":
      return formatSarifReport(result);
    default:
      return formatTextReport(result);
  }
}

interface ParsedArgs {
  scope?: string;
  format: Format;
  output?: string;
  since?: string;
  changedOnly?: boolean;
  maxFindings?: number;
  minScore?: number;
  rule?: string;
  apply?: boolean;
  dryRun?: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { format: "text" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--scope") {
      parsed.scope = next;
      index += 1;
    } else if (arg === "--format") {
      parsed.format = next as Format;
      index += 1;
    } else if (arg === "--output") {
      parsed.output = next;
      index += 1;
    } else if (arg === "--since") {
      parsed.since = next;
      index += 1;
    } else if (arg === "--changed-only") {
      parsed.changedOnly = true;
    } else if (arg === "--max-findings") {
      parsed.maxFindings = Number(next);
      index += 1;
    } else if (arg === "--min-score") {
      parsed.minScore = Number(next);
      index += 1;
    } else if (arg === "--rule") {
      parsed.rule = next;
      index += 1;
    } else if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    }
  }
  return parsed;
}

function parseScope(scopeValue?: string, since?: string) {
  if (!scopeValue || scopeValue === "workspace") {
    return { scope: "workspace" as const };
  }
  if (scopeValue.startsWith("package:")) {
    return { scope: "package" as const, value: scopeValue.slice("package:".length) };
  }
  if (scopeValue.startsWith("path:")) {
    return { scope: "path" as const, value: scopeValue.slice("path:".length) };
  }
  if (scopeValue === "changed") {
    return { scope: "changed" as const, value: since };
  }
  if (scopeValue.startsWith("since:")) {
    return { scope: "since" as const, value: scopeValue.slice("since:".length) };
  }
  return { scope: "workspace" as const };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
