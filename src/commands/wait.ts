import chalk from "chalk";
import ora from "ora";
import { requireApiKey } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
import {
  ExitCode,
  exitWithError,
  output,
  type OutputOptions,
} from "../lib/output.js";

export interface WaitOptions {
  timeout?: string;
  json?: boolean;
  quiet?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitCommand(
  jobId: string,
  options: WaitOptions
): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  const timeout = parseInt(options.timeout || "300", 10);
  const start = Date.now();

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);

    const spinner =
      options.json || options.quiet
        ? null
        : ora(`Waiting for job ${jobId}...`).start();

    while (true) {
      let job;
      try {
        const result = await api.getJob(jobId);
        job = result.job;
      } catch (error) {
        spinner?.fail("Failed to get job status");
        exitWithError(
          ExitCode.NOT_FOUND,
          {
            error: "job_not_found",
            message: `Job '${jobId}' not found.`,
            job_id: jobId,
          },
          outputOpts
        );
      }

      const elapsed = Math.floor((Date.now() - start) / 1000);

      if (job.isCompleted) {
        if (job.isSuccess) {
          spinner?.succeed(`Job completed in ${elapsed}s`);

          const result = {
            status: "completed",
            job_id: jobId,
            duration_seconds: elapsed,
          };

          if (options.json || options.quiet) {
            output(result, outputOpts);
          } else {
            console.log(chalk.green("\nJob completed successfully!"));
            console.log(
              chalk.yellow(`Run 'chucky fetch ${jobId}' to get results`)
            );
          }
          return;
        } else {
          spinner?.fail(`Job failed after ${elapsed}s`);
          exitWithError(
            ExitCode.CONFLICT,
            {
              error: "job_failed",
              message: job.error?.message || "Job failed",
              job_id: jobId,
            },
            outputOpts
          );
        }
      }

      // Check timeout
      if (elapsed >= timeout) {
        spinner?.fail("Timeout waiting for job");
        exitWithError(
          ExitCode.TIMEOUT,
          {
            error: "timeout",
            message: `Timeout after ${timeout}s waiting for job to complete.`,
            job_id: jobId,
          },
          outputOpts
        );
      }

      // Update spinner
      if (spinner) {
        spinner.text = `Waiting for job ${jobId}... (${elapsed}s / ${timeout}s)`;
      }

      // Poll every 2 seconds
      await sleep(2000);
    }
  } catch (error) {
    if ((error as any).code) {
      throw error;
    }

    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "wait_failed",
        message: (error as Error).message,
        job_id: jobId,
      },
      outputOpts
    );
  }
}
