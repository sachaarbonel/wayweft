export type Severity = "info" | "warning" | "error";
export type Confidence = "low" | "medium" | "high";
export type FindingCategory =
  | "complexity"
  | "duplication"
  | "architecture"
  | "maintainability";

export interface FixHandle {
  kind: "text-edit" | "codemod";
  fixId: string;
  safe: boolean;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  message: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  score: number;
  packageName?: string;
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
  symbolName?: string;
  evidence?: string[];
  suggestion?: string;
  fix?: FixHandle;
}

export interface RuleThresholds {
  maxLines?: number;
  maxDepth?: number;
  maxParams?: number;
  enabled?: boolean;
}

export interface WorkspaceConfig {
  rootMarkers?: string[];
  packageGlobs?: string[];
}

export interface AnalysisConfig {
  minScore?: number;
  changedOnlyDefault?: boolean;
  includeGitChurn?: boolean;
  baselineFile?: string;
}

export interface RuleConfigMap {
  [ruleId: string]: RuleThresholds;
}

export interface PackageOverrideConfig {
  rules?: RuleConfigMap;
  ignore?: string[];
}

export interface WayweftConfig {
  workspace?: WorkspaceConfig;
  analysis?: AnalysisConfig;
  rules?: RuleConfigMap;
  ignore?: string[];
  packages?: Record<string, PackageOverrideConfig>;
  boundaries?: Array<{
    from: string;
    allow: string[];
  }>;
}

export interface NormalizedRuleConfig {
  enabled: boolean;
  maxLines: number;
  maxDepth: number;
  maxParams: number;
}

export interface NormalizedConfig {
  workspace: Required<WorkspaceConfig>;
  analysis: Required<AnalysisConfig>;
  rules: Record<string, NormalizedRuleConfig>;
  ignore: string[];
  packages: Record<string, PackageOverrideConfig>;
  boundaries: Array<{
    from: string;
    allow: string[];
  }>;
}

export interface WorkspacePackage {
  name: string;
  dir: string;
  manifestPath: string;
  tsconfigPath?: string;
  dependencies: string[];
  internalDependencies: string[];
}

export interface Workspace {
  rootDir: string;
  packages: WorkspacePackage[];
  packageGraph: Map<string, string[]>;
  tsconfigGraph: Map<string, string[]>;
  fileInventory: string[];
  changedFiles: string[];
}

export interface ScanTarget {
  scope: "workspace" | "package" | "path" | "changed" | "since";
  value?: string;
}

export interface ScanOptions {
  cwd: string;
  target: ScanTarget;
  changedOnly?: boolean;
  since?: string;
  maxFindings?: number;
  minScore?: number;
  rule?: string;
}

export interface ScanResult {
  workspace: Workspace;
  findings: Finding[];
  packageHotspots: Array<{
    packageName: string;
    totalScore: number;
    findingCount: number;
  }>;
  summary: {
    findingCount: number;
    bySeverity: Record<Severity, number>;
    maxScore: number;
  };
}

export interface TextEdit {
  filePath: string;
  start: number;
  end: number;
  newText: string;
}

export interface FixPlan {
  ruleId: string;
  edits: TextEdit[];
}

export interface FixResult {
  applied: boolean;
  plans: FixPlan[];
  preview: string;
}
