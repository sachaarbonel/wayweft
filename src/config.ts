import { pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import type {
  NormalizedConfig,
  RefactorScoutConfig,
  RuleConfigMap,
  RuleThresholds,
} from "./types.js";

const configSchema: z.ZodType<RefactorScoutConfig> = z.object({
  workspace: z
    .object({
      rootMarkers: z.array(z.string()).optional(),
      packageGlobs: z.array(z.string()).optional(),
    })
    .optional(),
  analysis: z
    .object({
      minScore: z.number().optional(),
      changedOnlyDefault: z.boolean().optional(),
      includeGitChurn: z.boolean().optional(),
      baselineFile: z.string().optional(),
    })
    .optional(),
  rules: z.record(z.string(), z.any()).optional(),
  ignore: z.array(z.string()).optional(),
  packages: z.record(z.string(), z.any()).optional(),
  boundaries: z
    .array(
      z.object({
        from: z.string(),
        allow: z.array(z.string()),
      }),
    )
    .optional(),
});

const defaultRules: Record<string, NormalizedConfig["rules"][string]> = {
  "long-function": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
  "deep-nesting": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
  "too-many-params": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
  "boolean-param": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
  "cross-package-duplication": {
    enabled: true,
    maxLines: 45,
    maxDepth: 3,
    maxParams: 4,
  },
  "import-cycle": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
  "boundary-violation": { enabled: true, maxLines: 45, maxDepth: 3, maxParams: 4 },
} satisfies NormalizedConfig["rules"];

export function defineConfig(config: RefactorScoutConfig): RefactorScoutConfig {
  return config;
}

export async function loadConfig(cwd: string): Promise<NormalizedConfig> {
  const configPath = [
    "refactor-scout.config.ts",
    "refactor-scout.config.js",
    "refactor-scout.config.json",
  ]
    .map((candidate) => path.join(cwd, candidate))
    .find((candidate) => existsSync(candidate));

  let loaded: RefactorScoutConfig = {};
  if (configPath) {
    if (configPath.endsWith(".json")) {
      loaded = configSchema.parse(
        JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(configPath, "utf8"))),
      );
    } else if (configPath.endsWith(".ts")) {
      const source = await import("node:fs/promises").then((fs) => fs.readFile(configPath, "utf8"));
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: configPath,
      });
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
      const module = (await import(moduleUrl)) as { default?: RefactorScoutConfig };
      loaded = configSchema.parse(module.default ?? {});
    } else {
      const module = (await import(pathToFileURL(configPath).href)) as {
        default?: RefactorScoutConfig;
      };
      loaded = configSchema.parse(module.default ?? {});
    }
  }

  return normalizeConfig(loaded);
}

function normalizeRule(rule?: RuleThresholds) {
  return {
    enabled: rule?.enabled ?? true,
    maxLines: rule?.maxLines ?? 45,
    maxDepth: rule?.maxDepth ?? 3,
    maxParams: rule?.maxParams ?? 4,
  };
}

function mergeRules(rules?: RuleConfigMap): NormalizedConfig["rules"] {
  const merged = { ...defaultRules };
  for (const [ruleId, value] of Object.entries(rules ?? {})) {
    merged[ruleId] = normalizeRule(value);
  }
  return merged;
}

export function normalizeConfig(config: RefactorScoutConfig): NormalizedConfig {
  return {
    workspace: {
      rootMarkers: config.workspace?.rootMarkers ?? [
        "pnpm-workspace.yaml",
        "turbo.json",
        "nx.json",
        "rush.json",
        "package.json",
        ".git",
      ],
      packageGlobs: config.workspace?.packageGlobs ?? [
        "apps/*",
        "packages/*",
        "services/*",
        "libs/*",
      ],
    },
    analysis: {
      minScore: config.analysis?.minScore ?? 25,
      changedOnlyDefault: config.analysis?.changedOnlyDefault ?? false,
      includeGitChurn: config.analysis?.includeGitChurn ?? true,
      baselineFile: config.analysis?.baselineFile ?? ".refactor-scout-baseline.json",
    },
    rules: mergeRules(config.rules),
    ignore: config.ignore ?? [
      "**/dist/**",
      "**/coverage/**",
      "**/*.generated.*",
      "**/__snapshots__/**",
      "**/node_modules/**",
      "**/fixtures/**",
      "**/migrations/**",
    ],
    packages: config.packages ?? {},
    boundaries: config.boundaries ?? [],
  };
}
