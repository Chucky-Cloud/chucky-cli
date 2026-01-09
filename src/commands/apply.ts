import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi, isJobId } from "../lib/api.js";
import { applyBranch, branchExists, getBundleStats } from "../lib/git.js";
import {
  ExitCode,
  exitWithError,
  output,
  type OutputOptions,
} from "../lib/output.js";

export interface ApplyOptions {
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export async function applyCommand(
  id: string,
  options: ApplyOptions
): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  const isSession = !isJobId(id);

  try {
    const apiKey = requireApiKey();
    const projectConfig = requireProjectConfig();
    const api = new ChuckyApi(apiKey);
    const folder = projectConfig.folder || ".";
    const fullPath = resolve(folder);

    // Resolve partial session IDs
    const resolvedId = isSession ? await api.resolveSessionId(id, projectConfig.projectId) : id;
    const branchName = isSession ? `chucky/session-${resolvedId}` : `chucky/job-${resolvedId}`;

    // Use short ID for display
    const shortId = isSession ? resolvedId.slice(0, 8) : resolvedId;

    // Check if branch exists
    if (!branchExists(fullPath, branchName)) {
      exitWithError(
        ExitCode.NOT_FOUND,
        {
          error: "branch_not_found",
          message: `Branch '${branchName}' not found. Run 'chucky fetch ${shortId}' first.`,
          [isSession ? "session_id" : "job_id"]: resolvedId,
        },
        outputOpts
      );
    }

    const spinner =
      options.json || options.quiet ? null : ora("Applying changes...").start();

    // Get stats before apply
    const stats = getBundleStats(fullPath, branchName);

    try {
      // Try fast-forward first, auto-fallback to merge if diverged
      let result: { commits: number; files: number };
      let usedMerge = false;

      if (options.force) {
        result = applyBranch(fullPath, branchName, { force: true });
        usedMerge = true;
      } else {
        try {
          result = applyBranch(fullPath, branchName);
        } catch (ffError) {
          const ffMsg = (ffError as Error).message;
          if (ffMsg.includes("fast-forward") || ffMsg.includes("diverging")) {
            if (spinner) spinner.text = "Branches diverged, creating merge commit...";
            result = applyBranch(fullPath, branchName, { force: true });
            usedMerge = true;
          } else {
            throw ffError;
          }
        }
      }

      spinner?.succeed(
        `Applied ${result.commits} commit(s), ${result.files} file(s) changed${usedMerge ? " (merge commit)" : ""}`
      );

      const outputResult = {
        status: "applied",
        [isSession ? "session_id" : "job_id"]: resolvedId,
        commits_merged: result.commits,
        files_changed: result.files,
        insertions: stats.insertions,
        deletions: stats.deletions,
        merge_commit: usedMerge,
      };

      if (options.json || options.quiet) {
        output(outputResult, outputOpts);
      } else {
        console.log(chalk.dim(`\nChanges: +${stats.insertions} -${stats.deletions}`));
        console.log(chalk.green("\nChanges applied successfully!"));
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Check for actual merge conflict (not just diverging branches)
      if (
        errorMessage.includes("conflict") ||
        errorMessage.includes("CONFLICT")
      ) {
        spinner?.fail("Merge conflict");
        exitWithError(
          ExitCode.CONFLICT,
          {
            error: "merge_conflict",
            message: "Merge conflict detected. Resolve conflicts manually and commit.",
            [isSession ? "session_id" : "job_id"]: resolvedId,
          },
          outputOpts
        );
      }

      throw error;
    }
  } catch (error) {
    if ((error as any).code) {
      throw error;
    }

    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "apply_failed",
        message: (error as Error).message,
      },
      { json: options.json, quiet: options.quiet }
    );
  }
}
