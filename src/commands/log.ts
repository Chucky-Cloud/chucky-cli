import chalk from "chalk";
import { resolve } from "node:path";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi, isJobId } from "../lib/api.js";
import { getCommitLog, branchExists } from "../lib/git.js";
import {
  ExitCode,
  exitWithError,
  output,
  type OutputOptions,
} from "../lib/output.js";

export interface LogOptions {
  json?: boolean;
}

export async function logCommand(
  id: string,
  options: LogOptions
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

    const commits = getCommitLog(fullPath, branchName);

    if (options.json) {
      output(
        {
          [isSession ? "session_id" : "job_id"]: resolvedId,
          commits: commits.map((c) => ({
            hash: c.hash,
            message: c.message,
            files: c.filesChanged,
          })),
        },
        outputOpts
      );
    } else {
      console.log(chalk.bold(`\nCommits for ${isSession ? "session" : "job"} ${shortId}:\n`));

      if (commits.length === 0) {
        console.log(chalk.dim("  No commits found"));
      } else {
        for (const commit of commits) {
          console.log(
            chalk.yellow(commit.hash) +
              " " +
              commit.message +
              chalk.dim(` (${commit.filesChanged} files)`)
          );
        }
      }

      console.log("");
    }
  } catch (error) {
    if ((error as any).code) {
      throw error;
    }

    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "log_failed",
        message: (error as Error).message,
      },
      outputOpts
    );
  }
}
