import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import ignore, { type Ignore } from "ignore";
import yaml from "js-yaml";
import type { NormalizedConfig, ScanTarget, Workspace, WorkspacePackage } from "./types";
import { getChangedFiles } from "./utils/git";
import { normalizePath } from "./utils/fs";

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface CargoManifest {
  package?: { name?: string };
  workspace?: { members?: string[] };
  dependencies?: Record<string, unknown>;
  "dev-dependencies"?: Record<string, unknown>;
}

interface IgnoreMatcher {
  baseDir: string;
  matcher: Ignore;
}

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".rs"]);
const ignoreFileNames = [".gitignore", ".ignore"];

export async function discoverWorkspace(
  cwd: string,
  config: NormalizedConfig,
  target: ScanTarget,
  since?: string,
): Promise<Workspace> {
  const rootDir = findWorkspaceRoot(cwd, config.workspace.rootMarkers);
  const packageDirs = await discoverPackageDirs(rootDir, config.workspace.packageGlobs);
  const packages = packageDirs
    .map((dir) => loadPackage(rootDir, dir))
    .filter((pkg): pkg is WorkspacePackage => Boolean(pkg));
  const packageNames = new Set(packages.map((pkg) => pkg.name));

  for (const pkg of packages) {
    pkg.internalDependencies = pkg.dependencies.filter((dep) => packageNames.has(dep));
  }

  const scopedPackages = filterPackages(rootDir, packages, target, since);
  const tsconfigGraph = new Map<string, string[]>();
  for (const pkg of scopedPackages) {
    if (pkg.tsconfigPath && existsSync(pkg.tsconfigPath)) {
      tsconfigGraph.set(pkg.name, readTsconfigRefs(pkg.tsconfigPath));
    }
  }

  const fileInventory = collectSourceFiles(rootDir, scopedPackages, config.ignore);
  const changedFiles = getChangedFiles(rootDir, since)
    .map((file) => path.resolve(rootDir, file))
    .filter((filePath) => sourceExtensions.has(path.extname(filePath)));

  return {
    rootDir,
    packages: scopedPackages,
    packageGraph: new Map(scopedPackages.map((pkg) => [pkg.name, pkg.internalDependencies])),
    tsconfigGraph,
    fileInventory,
    changedFiles,
  };
}

function findWorkspaceRoot(startDir: string, markers: string[]): string {
  let current = path.resolve(startDir);
  while (true) {
    if (markers.some((marker) => existsSync(path.join(current, marker)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

async function discoverPackageDirs(rootDir: string, configuredGlobs: string[]): Promise<string[]> {
  const manifests = new Set<string>();

  const rootManifestPath = path.join(rootDir, "package.json");
  if (existsSync(rootManifestPath)) {
    manifests.add(rootManifestPath);
    const rootManifest = readManifest(rootManifestPath);
    const workspaceGlobs = readWorkspacePatterns(rootDir, rootManifest);
    for (const pattern of [...configuredGlobs, ...workspaceGlobs]) {
      const matches = await fg(`${pattern}/package.json`, { cwd: rootDir, absolute: true });
      for (const match of matches) {
        manifests.add(match);
      }
    }
  }

  const rootCargoPath = path.join(rootDir, "Cargo.toml");
  if (existsSync(rootCargoPath)) {
    manifests.add(rootCargoPath);
    const cargo = readCargoManifest(rootCargoPath);
    const memberGlobs = cargo.workspace?.members ?? [];
    for (const pattern of memberGlobs) {
      const matches = await fg(`${pattern}/Cargo.toml`, { cwd: rootDir, absolute: true });
      for (const match of matches) {
        manifests.add(match);
      }
    }
  }

  return [...manifests].map((manifest) => path.dirname(manifest));
}

function readWorkspacePatterns(rootDir: string, manifest: PackageManifest): string[] {
  const patterns: string[] = [];
  const pnpmWorkspacePath = path.join(rootDir, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    const parsed = yaml.load(readFileSync(pnpmWorkspacePath, "utf8")) as { packages?: string[] } | undefined;
    patterns.push(...(parsed?.packages ?? []));
  }

  const workspaces = (manifest as PackageManifest & { workspaces?: string[] | { packages?: string[] } }).workspaces;
  if (Array.isArray(workspaces)) {
    patterns.push(...workspaces);
  } else if (workspaces?.packages) {
    patterns.push(...workspaces.packages);
  }

  return patterns;
}

function loadPackage(rootDir: string, dir: string): WorkspacePackage | undefined {
  const manifestPath = path.join(dir, "package.json");
  if (existsSync(manifestPath)) {
    const manifest = readManifest(manifestPath);
    const name = (manifest.name ?? normalizePath(path.relative(rootDir, dir))) || "root";
    const tsconfigPath = findTsconfig(dir);
    const dependencies = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    return {
      name,
      dir,
      manifestPath,
      tsconfigPath,
      dependencies,
      internalDependencies: [],
    };
  }

  const cargoManifestPath = path.join(dir, "Cargo.toml");
  if (existsSync(cargoManifestPath)) {
    return loadCargoPackage(rootDir, dir, cargoManifestPath);
  }

  return undefined;
}

function loadCargoPackage(rootDir: string, dir: string, manifestPath: string): WorkspacePackage {
  const cargo = readCargoManifest(manifestPath);
  const name = (cargo.package?.name ?? normalizePath(path.relative(rootDir, dir))) || "root";
  const dependencies = [
    ...Object.keys(cargo.dependencies ?? {}),
    ...Object.keys(cargo["dev-dependencies"] ?? {}),
  ];

  return {
    name,
    dir,
    manifestPath,
    tsconfigPath: undefined,
    dependencies,
    internalDependencies: [],
  };
}

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function readCargoManifest(manifestPath: string): CargoManifest {
  const content = readFileSync(manifestPath, "utf8");
  return parseCargoToml(content);
}

function parseCargoToml(content: string): CargoManifest {
  const result: CargoManifest = {};
  let currentSection = "";
  let collectingArray = false;
  let arrayKey = "";
  let arrayValues: string[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (collectingArray) {
      if (line === "]") {
        collectingArray = false;
        if (currentSection === "workspace" && arrayKey === "members") {
          result.workspace = { ...result.workspace, members: arrayValues };
        }
        arrayValues = [];
        arrayKey = "";
      } else {
        const valueMatch = /^"([^"]+)"/.exec(line.replace(/,\s*$/, ""));
        if (valueMatch) {
          arrayValues.push(valueMatch[1]);
        }
      }
      continue;
    }

    if (line.startsWith("[") && !line.startsWith("[[")) {
      currentSection = line.replace(/^\[+/, "").replace(/\]+.*$/, "").trim();
      if (currentSection === "package") result.package = result.package ?? {};
      if (currentSection === "workspace") result.workspace = result.workspace ?? {};
      if (currentSection === "dependencies") result.dependencies = result.dependencies ?? {};
      if (currentSection === "dev-dependencies") result["dev-dependencies"] = result["dev-dependencies"] ?? {};
      continue;
    }

    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (currentSection === "package" && key === "name") {
      const nameMatch = /^"([^"]*)"/.exec(value);
      if (nameMatch) {
        result.package = { ...result.package, name: nameMatch[1] };
      }
    } else if (currentSection === "workspace" && key === "members") {
      if (value.startsWith("[") && !value.includes("]")) {
        collectingArray = true;
        arrayKey = "members";
        arrayValues = [];
      } else if (value.startsWith("[") && value.includes("]")) {
        const inline = value.slice(1, value.lastIndexOf("]"));
        const members: string[] = [];
        for (const part of inline.split(",")) {
          const m = /^"([^"]+)"/.exec(part.trim());
          if (m) members.push(m[1]);
        }
        result.workspace = { ...result.workspace, members };
      }
    } else if (currentSection === "dependencies" && result.dependencies) {
      (result.dependencies as Record<string, unknown>)[key] = value;
    } else if (currentSection === "dev-dependencies" && result["dev-dependencies"]) {
      (result["dev-dependencies"] as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

function findTsconfig(dir: string): string | undefined {
  const candidates = [
    "tsconfig.json",
    "tsconfig.build.json",
    "tsconfig.app.json",
    "tsconfig.lib.json",
  ];
  return candidates
    .map((candidate) => path.join(dir, candidate))
    .find((candidate) => existsSync(candidate));
}

function readTsconfigRefs(tsconfigPath: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      extends?: string;
      references?: Array<{ path: string }>;
    };
    const refs = parsed.references?.map((ref) => ref.path) ?? [];
    if (parsed.extends) {
      refs.push(parsed.extends);
    }
    return refs;
  } catch {
    return [];
  }
}

function filterPackages(
  rootDir: string,
  packages: WorkspacePackage[],
  target: ScanTarget,
  since?: string,
): WorkspacePackage[] {
  if (target.scope === "workspace") {
    return packages;
  }
  if (target.scope === "package" && target.value) {
    return packages.filter((pkg) => pkg.name === target.value);
  }
  if (target.scope === "path" && target.value) {
    const resolved = path.resolve(rootDir, target.value);
    return packages.filter((pkg) => pkg.dir.startsWith(resolved) || resolved.startsWith(pkg.dir));
  }
  if ((target.scope === "changed" || target.scope === "since") && (since || target.scope === "changed")) {
    const changed = new Set(
      getChangedFiles(rootDir, since).map((file) => path.resolve(rootDir, file)),
    );
    return packages.filter((pkg) => [...changed].some((filePath) => filePath.startsWith(pkg.dir)));
  }
  return packages;
}

export function matchesIgnore(filePath: string, rootDir: string, ignore: string[]): boolean {
  const relative = normalizePath(path.relative(rootDir, filePath));
  return buildIgnoreMatcher("", ignore).matcher.test(relative).ignored;
}

function collectSourceFiles(
  rootDir: string,
  scopedPackages: WorkspacePackage[],
  configuredIgnore: string[],
): string[] {
  const scanRoots = getScanRoots(rootDir, scopedPackages);
  const rootMatchers = [buildIgnoreMatcher("", configuredIgnore)];
  const files = new Set<string>();

  for (const scanRoot of scanRoots) {
    walkDir(rootDir, scanRoot, rootMatchers, files);
  }

  return [...files].sort();
}

function getScanRoots(rootDir: string, scopedPackages: WorkspacePackage[]): string[] {
  const directories = scopedPackages.length > 0
    ? [...new Set(scopedPackages.map((pkg) => path.resolve(pkg.dir)))]
    : [path.resolve(rootDir)];

  return directories
    .sort((left, right) => left.length - right.length)
    .filter((dir, index, all) =>
      !all.slice(0, index).some((candidate) => dir === candidate || dir.startsWith(`${candidate}${path.sep}`)),
    );
}

function walkDir(
  rootDir: string,
  dirPath: string,
  activeMatchers: IgnoreMatcher[],
  files: Set<string>,
) {
  const matchers = [...activeMatchers, ...loadIgnoreMatchers(rootDir, dirPath)];
  const entries = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !ignoreFileNames.includes(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = normalizePath(path.relative(rootDir, entryPath));
    if (isIgnored(relativePath, entry.isDirectory(), matchers)) {
      continue;
    }
    if (entry.isDirectory()) {
      walkDir(rootDir, entryPath, matchers, files);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.add(path.resolve(entryPath));
    }
  }
}

function loadIgnoreMatchers(rootDir: string, dirPath: string): IgnoreMatcher[] {
  const baseDir = normalizePath(path.relative(rootDir, dirPath));
  const matchers: IgnoreMatcher[] = [];

  for (const fileName of ignoreFileNames) {
    const ignorePath = path.join(dirPath, fileName);
    if (!existsSync(ignorePath)) {
      continue;
    }

    const contents = readFileSync(ignorePath, "utf8");
    if (!contents.trim()) {
      continue;
    }

    matchers.push(buildIgnoreMatcher(baseDir, contents));
  }

  return matchers;
}

function buildIgnoreMatcher(baseDir: string, patterns: string[] | string): IgnoreMatcher {
  return {
    baseDir,
    matcher: ignore({ allowRelativePaths: true }).add(patterns),
  };
}

function isIgnored(relativePath: string, isDirectory: boolean, matchers: IgnoreMatcher[]): boolean {
  let ignored = false;

  for (const matcher of matchers) {
    const candidate = getMatcherCandidate(relativePath, matcher.baseDir, isDirectory);
    if (!candidate) {
      continue;
    }

    const result = matcher.matcher.test(candidate);
    if (result.ignored) {
      ignored = true;
    }
    if (result.unignored) {
      ignored = false;
    }
  }

  return ignored;
}

function getMatcherCandidate(relativePath: string, baseDir: string, isDirectory: boolean): string | undefined {
  if (!baseDir) {
    return isDirectory ? `${relativePath}/` : relativePath;
  }

  const prefix = `${baseDir}/`;
  if (relativePath !== baseDir && !relativePath.startsWith(prefix)) {
    return undefined;
  }

  const candidate = relativePath === baseDir ? "" : relativePath.slice(prefix.length);
  if (!candidate) {
    return undefined;
  }

  return isDirectory ? `${candidate}/` : candidate;
}
