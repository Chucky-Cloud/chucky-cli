import chalk from "chalk";
import ora from "ora";
import { createWriteStream, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { requireApiKey, requireProjectConfig } from "../lib/config.js";
import { ChuckyApi, isJobId } from "../lib/api.js";
import {
  verifyBundle,
  fetchBundle,
  getBundleStats,
  branchExists,
} from "../lib/git.js";
import {
  ExitCode,
  exitWithError,
  output,
  type OutputOptions,
} from "../lib/output.js";

export interface FetchOptions {
  json?: boolean;
  quiet?: boolean;
}

export async function fetchCommand(
  id: string,
  options: FetchOptions
): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  let bundlePath: string | null = null;

  try {
    const apiKey = requireApiKey();
    const projectConfig = requireProjectConfig();
    const api = new ChuckyApi(apiKey);

    const folder = projectConfig.folder || ".";
    const fullPath = resolve(folder);

    // Resolve partial session IDs
    const isSession = !isJobId(id);
    const resolvedId = isSession ? await api.resolveSessionId(id, projectConfig.projectId) : id;
    const branchName = isSession ? `chucky/session-${resolvedId}` : `chucky/job-${resolvedId}`;

    // Check if branch already exists
    if (branchExists(fullPath, branchName)) {
      exitWithError(
        ExitCode.CONFLICT,
        {
          error: "branch_exists",
          message: `Branch '${branchName}' already exists. Use 'chucky apply ${resolvedId}' or 'chucky discard ${resolvedId}' first.`,
          branch: branchName,
        },
        outputOpts
      );
    }

    // Get bundle download URL
    const spinner =
      options.json || options.quiet ? null : ora(`Getting ${isSession ? "session" : "job"} bundle...`).start();

    let bundleInfo: { downloadUrl: string; hasChanges: boolean };
    try {
      if (isSession) {
        const result = await api.getSessionBundle(resolvedId);
        bundleInfo = { downloadUrl: result.download_url, hasChanges: result.has_changes };
      } else {
        bundleInfo = await api.getJobBundle(resolvedId);
      }
    } catch (error) {
      spinner?.fail(`Failed to get ${isSession ? "session" : "job"} bundle`);
      exitWithError(
        ExitCode.NOT_FOUND,
        {
          error: isSession ? "session_not_found" : "job_not_found",
          message: `${isSession ? "Session" : "Job"} '${resolvedId}' not found or has no bundle available.`,
          [isSession ? "session_id" : "job_id"]: resolvedId,
        },
        outputOpts
      );
    }

    if (!bundleInfo.hasChanges) {
      spinner?.succeed(`${isSession ? "Session" : "Job"} completed with no changes`);
      exitWithError(
        ExitCode.NO_CHANGES,
        {
          error: "no_changes",
          message: "Agent made no changes.",
          [isSession ? "session_id" : "job_id"]: resolvedId,
        },
        outputOpts
      );
    }

    if (spinner) spinner.text = "Downloading bundle...";

    // Download bundle
    bundlePath = join(tmpdir(), `chucky-bundle-${resolvedId}.bundle`);
    const response = await fetch(bundleInfo.downloadUrl);

    if (!response.ok || !response.body) {
      spinner?.fail("Failed to download bundle");
      exitWithError(
        ExitCode.NETWORK_ERROR,
        {
          error: "download_failed",
          message: "Failed to download bundle from server.",
          [isSession ? "session_id" : "job_id"]: resolvedId,
        },
        outputOpts
      );
    }

    const fileStream = createWriteStream(bundlePath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);

    if (spinner) spinner.text = "Verifying bundle...";

    // Verify bundle
    if (!verifyBundle(fullPath, bundlePath)) {
      spinner?.fail("Bundle verification failed");
      exitWithError(
        ExitCode.CONFLICT,
        {
          error: "invalid_bundle",
          message: "Bundle verification failed. The bundle may be corrupted.",
          [isSession ? "session_id" : "job_id"]: resolvedId,
        },
        outputOpts
      );
    }

    if (spinner) spinner.text = "Fetching to branch...";

    // Fetch to temp branch
    fetchBundle(fullPath, bundlePath, branchName);

    // Get stats
    const stats = getBundleStats(fullPath, branchName);

    spinner?.succeed(`Fetched ${stats.commits} commit(s) to ${branchName}`);

    // Clean up bundle file
    if (bundlePath && existsSync(bundlePath)) {
      unlinkSync(bundlePath);
    }

    const result = {
      status: "fetched",
      [isSession ? "session_id" : "job_id"]: resolvedId,
      branch: branchName,
      commits: stats.commits,
      files_added: stats.filesAdded,
      files_modified: stats.filesModified,
      files_deleted: stats.filesDeleted,
      insertions: stats.insertions,
      deletions: stats.deletions,
    };

    // Use short ID for display (first 8 chars for sessions)
    const shortId = isSession ? resolvedId.slice(0, 8) : resolvedId;

    if (options.json || options.quiet) {
      output(result, outputOpts);
    } else {
      console.log(chalk.dim(`\nFiles added: ${stats.filesAdded.length}`));
      console.log(chalk.dim(`Files modified: ${stats.filesModified.length}`));
      console.log(chalk.dim(`Files deleted: ${stats.filesDeleted.length}`));
      console.log(
        chalk.dim(`Changes: +${stats.insertions} -${stats.deletions}`)
      );
      console.log(
        chalk.yellow(`\nRun 'chucky diff ${shortId}' to see changes`)
      );
      console.log(chalk.yellow(`Run 'chucky apply ${shortId}' to apply changes`));
      console.log(chalk.yellow(`Run 'chucky discard ${shortId}' to discard`));
    }
  } catch (error) {
    // Clean up bundle file on error
    if (bundlePath && existsSync(bundlePath)) {
      try {
        unlinkSync(bundlePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    if ((error as any).code) {
      // Already handled error
      throw error;
    }

    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "fetch_failed",
        message: (error as Error).message,
      },
      outputOpts
    );
  }
}
