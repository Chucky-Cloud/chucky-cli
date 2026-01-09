import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GitInfo {
  isRepo: boolean;
  isRoot: boolean;
  headCommit: string;
  isDirty: boolean;
  dirtyFiles: string[];
}

export interface BundleStats {
  commits: number;
  filesAdded: string[];
  filesModified: string[];
  filesDeleted: string[];
  insertions: number;
  deletions: number;
}

export interface CommitInfo {
  hash: string;
  message: string;
  filesChanged: number;
}

/**
 * Execute a git command and return stdout
 */
function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }

  return result.stdout.trim();
}

/**
 * Execute a git command, returning null on failure instead of throwing
 */
function gitSafe(args: string[], cwd: string): string | null {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

/**
 * Get git repository information for a folder
 */
export function getGitInfo(folder: string): GitInfo {
  const fullPath = resolve(folder);

  // Check if .git exists in this folder (is root)
  const isRoot = existsSync(join(fullPath, ".git"));

  // Check if it's inside any git repo
  const gitDir = gitSafe(["rev-parse", "--git-dir"], fullPath);
  const isRepo = gitDir !== null;

  if (!isRepo) {
    return {
      isRepo: false,
      isRoot: false,
      headCommit: "",
      isDirty: false,
      dirtyFiles: [],
    };
  }

  // Get HEAD commit
  const headCommit = gitSafe(["rev-parse", "HEAD"], fullPath) || "";

  // Get dirty files
  const status = gitSafe(["status", "--porcelain"], fullPath) || "";
  const dirtyFiles = status
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.slice(3));

  return {
    isRepo,
    isRoot,
    headCommit,
    isDirty: dirtyFiles.length > 0,
    dirtyFiles,
  };
}

/**
 * Auto-commit all changes
 */
export function autoCommit(folder: string, message: string): string {
  const fullPath = resolve(folder);

  git(["add", "-A"], fullPath);
  git(["commit", "-m", message], fullPath);

  return git(["rev-parse", "HEAD"], fullPath);
}

/**
 * Create a git bundle from a commit range
 */
export function createBundle(
  folder: string,
  fromCommit: string,
  outputPath: string
): boolean {
  const fullPath = resolve(folder);

  // Check if there are any commits in the range
  const revList = gitSafe(["rev-list", `${fromCommit}..HEAD`], fullPath);
  if (!revList || revList.trim() === "") {
    return false; // No changes
  }

  git(["bundle", "create", outputPath, `${fromCommit}..HEAD`], fullPath);
  return true;
}

/**
 * Verify a git bundle
 */
export function verifyBundle(folder: string, bundlePath: string): boolean {
  const fullPath = resolve(folder);

  try {
    git(["bundle", "verify", bundlePath], fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a bundle to a branch
 */
export function fetchBundle(
  folder: string,
  bundlePath: string,
  branchName: string
): void {
  const fullPath = resolve(folder);

  // Fetch from bundle to the specified branch
  git(["fetch", bundlePath, `HEAD:${branchName}`], fullPath);
}

/**
 * Get stats for changes between HEAD and a branch
 */
export function getBundleStats(folder: string, branchName: string): BundleStats {
  const fullPath = resolve(folder);

  // Get commit count
  const revList = gitSafe(["rev-list", `HEAD..${branchName}`], fullPath) || "";
  const commits = revList ? revList.split("\n").filter((l) => l.trim()).length : 0;

  // Get file stats
  const diffStat = gitSafe(
    ["diff", "--numstat", `HEAD..${branchName}`],
    fullPath
  ) || "";

  let insertions = 0;
  let deletions = 0;

  for (const line of diffStat.split("\n").filter((l) => l.trim())) {
    const [added, removed] = line.split("\t");
    if (added !== "-") insertions += parseInt(added, 10) || 0;
    if (removed !== "-") deletions += parseInt(removed, 10) || 0;
  }

  // Get file change types
  const diffFiles = gitSafe(
    ["diff", "--name-status", `HEAD..${branchName}`],
    fullPath
  ) || "";

  const filesAdded: string[] = [];
  const filesModified: string[] = [];
  const filesDeleted: string[] = [];

  for (const line of diffFiles.split("\n").filter((l) => l.trim())) {
    const [status, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t");

    if (status.startsWith("A")) {
      filesAdded.push(file);
    } else if (status.startsWith("M")) {
      filesModified.push(file);
    } else if (status.startsWith("D")) {
      filesDeleted.push(file);
    }
  }

  return {
    commits,
    filesAdded,
    filesModified,
    filesDeleted,
    insertions,
    deletions,
  };
}

/**
 * Get full diff between HEAD and a branch
 */
export function getFullDiff(folder: string, branchName: string): string {
  const fullPath = resolve(folder);
  return git(["diff", `HEAD..${branchName}`], fullPath);
}

/**
 * Get commit log between HEAD and a branch
 */
export function getCommitLog(folder: string, branchName: string): CommitInfo[] {
  const fullPath = resolve(folder);

  const log = gitSafe(
    ["log", "--oneline", "--numstat", `HEAD..${branchName}`],
    fullPath
  ) || "";

  const commits: CommitInfo[] = [];
  let currentCommit: CommitInfo | null = null;

  for (const line of log.split("\n")) {
    if (!line.trim()) continue;

    // Commit line: "abc1234 Commit message here"
    const commitMatch = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (commitMatch && !line.includes("\t")) {
      if (currentCommit) {
        commits.push(currentCommit);
      }
      currentCommit = {
        hash: commitMatch[1],
        message: commitMatch[2],
        filesChanged: 0,
      };
    } else if (currentCommit && line.includes("\t")) {
      // File stat line
      currentCommit.filesChanged++;
    }
  }

  if (currentCommit) {
    commits.push(currentCommit);
  }

  return commits;
}

/**
 * Apply a branch (fast-forward merge)
 */
export function applyBranch(
  folder: string,
  branchName: string,
  options?: { force?: boolean }
): { commits: number; files: number } {
  const fullPath = resolve(folder);

  const stats = getBundleStats(fullPath, branchName);

  if (options?.force) {
    // Use --no-edit to avoid interactive editor, provide merge commit message
    git(["merge", "--no-edit", "-m", `Merge ${branchName}`, branchName], fullPath);
  } else {
    git(["merge", "--ff-only", branchName], fullPath);
  }

  // Clean up the branch
  git(["branch", "-d", branchName], fullPath);

  return {
    commits: stats.commits,
    files: stats.filesAdded.length + stats.filesModified.length + stats.filesDeleted.length,
  };
}

/**
 * Discard a branch (delete without merging)
 */
export function discardBranch(folder: string, branchName: string): void {
  const fullPath = resolve(folder);

  // Use -D to force delete even if not merged
  gitSafe(["branch", "-D", branchName], fullPath);
}

/**
 * Check if a branch exists
 */
export function branchExists(folder: string, branchName: string): boolean {
  const fullPath = resolve(folder);
  const result = gitSafe(["rev-parse", "--verify", branchName], fullPath);
  return result !== null;
}
