import { defineConfig } from "./src/config.js";

export default defineConfig({
  workspace: {
    rootMarkers: ["pnpm-workspace.yaml", "turbo.json", "nx.json", "package.json", ".git"],
    packageGlobs: ["apps/*", "packages/*", "services/*", "libs/*"],
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
    "import-cycle": { enabled: true },
    "boundary-violation": { enabled: true },
  },
  ignore: [
    "**/dist/**",
    "**/coverage/**",
    "**/*.generated.*",
    "**/__snapshots__/**",
    "**/node_modules/**",
  ],
});
