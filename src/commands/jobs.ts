import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireApiKey } from "../lib/config.js";
import { ChuckyApi, type Job } from "../lib/api.js";

function formatStatus(job: Job): string {
  const status = job.status.toUpperCase();
  if (job.isSuccess) return chalk.green(status);
  if (job.isFailed) return chalk.red(status);
  if (status === "EXECUTING") return chalk.blue(status);
  if (status === "QUEUED" || status === "PENDING") return chalk.yellow(status);
  return chalk.dim(status);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function formatDuration(startedAt?: string, finishedAt?: string): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

async function listJobs(options: {
  status?: string;
  limit?: string;
}): Promise<void> {
  const spinner = ora("Fetching jobs...").start();

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);
    const result = await api.listJobs({
      status: options.status,
      size: options.limit ? parseInt(options.limit, 10) : 25,
    });

    spinner.stop();

    if (result.jobs.length === 0) {
      console.log(chalk.yellow("\nNo jobs found."));
      return;
    }

    console.log(chalk.bold(`\nJobs (${result.jobs.length}):\n`));

    for (const job of result.jobs) {
      const duration = formatDuration(job.startedAt, job.finishedAt);
      console.log(`  ${chalk.bold(job.id)}`);
      console.log(`    Status: ${formatStatus(job)}`);
      console.log(`    Created: ${chalk.dim(formatDate(job.createdAt))}`);
      if (job.startedAt) {
        console.log(`    Duration: ${chalk.dim(duration)}`);
      }
      console.log();
    }

    if (result.hasMore) {
      console.log(chalk.dim("  More jobs available. Use --limit to see more."));
    }
  } catch (error) {
    spinner.fail("Failed to fetch jobs");
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function getJob(jobId: string): Promise<void> {
  const spinner = ora("Fetching job...").start();

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);
    const { job } = await api.getJob(jobId);

    spinner.stop();

    console.log(chalk.bold(`\nJob: ${job.id}\n`));
    console.log(`  Status: ${formatStatus(job)}`);
    console.log(`  Task: ${chalk.dim(job.taskIdentifier)}`);
    console.log(`  Created: ${chalk.dim(formatDate(job.createdAt))}`);
    if (job.startedAt) {
      console.log(`  Started: ${chalk.dim(formatDate(job.startedAt))}`);
    }
    if (job.finishedAt) {
      console.log(`  Finished: ${chalk.dim(formatDate(job.finishedAt))}`);
    }
    console.log(
      `  Duration: ${chalk.dim(formatDuration(job.startedAt, job.finishedAt))}`
    );
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch job");
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function cancelJob(jobId: string): Promise<void> {
  const spinner = ora("Cancelling job...").start();

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);
    await api.cancelJob(jobId);

    spinner.succeed(`Job ${jobId} cancelled`);
  } catch (error) {
    spinner.fail("Failed to cancel job");
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

export function createJobsCommand(): Command {
  const cmd = new Command("jobs").description("Manage jobs (background runs)");

  cmd
    .command("list")
    .description("List recent jobs")
    .option(
      "-s, --status <status>",
      "Filter by status (PENDING, QUEUED, EXECUTING, COMPLETED, FAILED, CANCELED)"
    )
    .option("-l, --limit <number>", "Number of jobs to show", "25")
    .action(listJobs);

  cmd
    .command("get <jobId>")
    .description("Get details of a specific job")
    .action(getJob);

  cmd
    .command("cancel <jobId>")
    .description("Cancel a running job")
    .action(cancelJob);

  return cmd;
}
