import chalk from "chalk";
import { resolve } from "node:path";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi, isJobId } from "../lib/api.js";
import { getBundleStats, getFullDiff, branchExists } from "../lib/git.js";
import {
  ExitCode,
  exitWithError,
  output,
  type OutputOptions,
} from "../lib/output.js";

export interface DiffOptions {
  json?: boolean;
  stat?: boolean;
}

export async function diffCommand(
  id: string,
  options: DiffOptions
): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: false,
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

    // Use short ID for display (first 8 chars for sessions)
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

    if (options.json || options.stat) {
      const stats = getBundleStats(fullPath, branchName);

      const result = {
        [isSession ? "session_id" : "job_id"]: resolvedId,
        files_added: stats.filesAdded,
        files_modified: stats.filesModified,
        files_deleted: stats.filesDeleted,
        insertions: stats.insertions,
        deletions: stats.deletions,
      };

      if (options.json) {
        output(result, outputOpts);
      } else {
        // --stat without --json: show human-readable stats
        console.log(chalk.bold(`\nChanges for ${isSession ? "session" : "job"} ${shortId}:\n`));

        if (stats.filesAdded.length > 0) {
          console.log(chalk.green("Added:"));
          for (const file of stats.filesAdded) {
            console.log(chalk.green(`  + ${file}`));
          }
        }

        if (stats.filesModified.length > 0) {
          console.log(chalk.yellow("\nModified:"));
          for (const file of stats.filesModified) {
            console.log(chalk.yellow(`  ~ ${file}`));
          }
        }

        if (stats.filesDeleted.length > 0) {
          console.log(chalk.red("\nDeleted:"));
          for (const file of stats.filesDeleted) {
            console.log(chalk.red(`  - ${file}`));
          }
        }

        console.log(
          chalk.dim(`\nTotal: +${stats.insertions} -${stats.deletions}`)
        );
      }
    } else {
      // Full diff output
      try {
        const diff = getFullDiff(fullPath, branchName);
        console.log(diff);
      } catch (diffError) {
        // Handle buffer overflow for very large diffs
        if ((diffError as any).code === "ENOBUFS") {
          console.log(chalk.yellow("\nDiff output is too large to display."));
          console.log(chalk.dim(`Use 'chucky diff ${shortId} --stat' to see a summary instead.\n`));

          // Show a quick summary
          const stats = getBundleStats(fullPath, branchName);
          console.log(chalk.dim(`Files: ${stats.filesAdded.length} added, ${stats.filesModified.length} modified, ${stats.filesDeleted.length} deleted`));
          console.log(chalk.dim(`Lines: +${stats.insertions} -${stats.deletions}`));
        } else {
          throw diffError;
        }
      }
    }
  } catch (error) {
    if ((error as any).code) {
      throw error;
    }

    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "diff_failed",
        message: (error as Error).message,
      },
      outputOpts
    );
  }
}
