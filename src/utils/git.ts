import { execFileSync } from "node:child_process";

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getChangedFiles(cwd: string, since?: string): string[] {
  if (!isGitRepo(cwd)) {
    return [];
  }

  try {
    const args = since
      ? ["diff", "--name-only", `${since}...HEAD`]
      : ["diff", "--name-only", "--cached", "HEAD"];
    const output = execFileSync("git", args, { cwd, encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getChurnMap(cwd: string, files: string[]): Map<string, number> {
  const churn = new Map<string, number>();
  if (!isGitRepo(cwd) || files.length === 0) {
    return churn;
  }

  for (const file of files) {
    try {
      const output = execFileSync(
        "git",
        ["log", "--pretty=format:%H", "--follow", "--", file],
        { cwd, encoding: "utf8" },
      );
      const commits = output.split("\n").filter(Boolean).length;
      churn.set(file, commits);
    } catch {
      churn.set(file, 0);
    }
  }

  return churn;
}

export function getAuthorSpreadMap(cwd: string, files: string[]): Map<string, number> {
  const spread = new Map<string, number>();
  if (!isGitRepo(cwd) || files.length === 0) {
    return spread;
  }

  for (const file of files) {
    try {
      const output = execFileSync("git", ["log", "--format=%an", "--follow", "--", file], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const authors = new Set(
        output
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      spread.set(file, authors.size);
    } catch {
      spread.set(file, 0);
    }
  }

  return spread;
}
