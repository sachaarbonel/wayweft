import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import yaml from "js-yaml";
import { minimatch } from "minimatch";
import type { NormalizedConfig, ScanTarget, Workspace, WorkspacePackage } from "./types.js";
import { getChangedFiles } from "./utils/git.js";
import { normalizePath } from "./utils/fs.js";

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

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

  const fileInventory = await fg(
    scopedPackages.length > 0
      ? scopedPackages.map((pkg) => {
          const relative = normalizePath(path.relative(rootDir, pkg.dir));
          return relative ? `${relative}/**/*.{ts,tsx,js,jsx}` : "**/*.{ts,tsx,js,jsx}";
        })
      : ["**/*.{ts,tsx,js,jsx}"],
    {
      cwd: rootDir,
      absolute: true,
      ignore: config.ignore,
      dot: false,
    },
  );

  return {
    rootDir,
    packages: scopedPackages,
    packageGraph: new Map(scopedPackages.map((pkg) => [pkg.name, pkg.internalDependencies])),
    tsconfigGraph,
    fileInventory,
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
  if (!existsSync(manifestPath)) {
    return undefined;
  }

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

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
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
  return ignore.some((pattern) => minimatch(relative, pattern));
}
