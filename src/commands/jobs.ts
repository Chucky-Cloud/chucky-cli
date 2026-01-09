import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { requireApiKey, requireProjectConfig, loadProjectConfig, getWorkerUrl } from "../lib/config.js";
import { ChuckyApi, type Job } from "../lib/api.js";
import { generateToken } from "../lib/token.js";
import { verifyBundle, fetchBundle, applyBranch, branchExists } from "../lib/git.js";

interface IncubateResponse {
  vesselId: string;
  idempotencyKey: string;
  status: string;
  scheduledFor?: string;
  error?: string;
  message?: string;
}

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

async function getJob(jobId: string, options: { json?: boolean } = {}): Promise<void> {
  const spinner = ora("Fetching job...").start();

  try {
    const apiKey = requireApiKey();
    const api = new ChuckyApi(apiKey);
    const { job } = await api.getJob(jobId);

    spinner.stop();

    // JSON output mode
    if (options.json) {
      console.log(JSON.stringify(job, null, 2));
      return;
    }

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

    // Show error if failed
    if (job.error) {
      console.log();
      console.log(chalk.red(`  Error: ${job.error.message}`));
    }

    // Show output/response if available
    if (job.output !== undefined) {
      console.log();
      console.log(chalk.bold("  Response:"));
      const outputStr = typeof job.output === "string"
        ? job.output
        : JSON.stringify(job.output, null, 2);
      // Indent each line
      const indented = outputStr.split("\n").map(line => `    ${line}`).join("\n");
      console.log(chalk.cyan(indented));
    }

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

async function createJob(
  message: string,
  options: {
    model?: string;
    systemPrompt?: string;
    maxTurns?: string;
    callbackUrl?: string;
    callbackSecret?: string;
    ttl?: string;
    wait?: boolean;
    apply?: boolean;
    // SDK options
    tools?: string;
    allowedTools?: string;
    disallowedTools?: string;
    permissionMode?: string;
    dangerouslySkipPermissions?: boolean;
  }
): Promise<void> {
  const spinner = ora("Creating job...").start();

  try {
    // Get project config and API key
    const projectConfig = requireProjectConfig();
    const apiKey = requireApiKey();

    if (!projectConfig.projectId) {
      throw new Error("No project ID found. Run 'chucky init' first.");
    }

    // Fetch HMAC key from API
    spinner.text = "Fetching HMAC key...";
    const api = new ChuckyApi(apiKey);
    const { hmacKey } = await api.getHmacKey(projectConfig.projectId);

    // Generate JWT token
    spinner.text = "Creating job...";
    const token = generateToken({
      projectId: projectConfig.projectId,
      hmacSecret: hmacKey,
      expiresInSeconds: 3600, // 1 hour
    });

    // Generate idempotency key
    const idempotencyKey = `cli-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    // Build request body
    const workerUrl = getWorkerUrl();

    // Parse tools option (can be JSON or comma-separated)
    let toolsValue: unknown = undefined;
    if (options.tools) {
      try {
        toolsValue = JSON.parse(options.tools);
      } catch {
        toolsValue = options.tools.split(",").map((t) => t.trim());
      }
    }

    // Handle permission mode
    let permissionMode = options.permissionMode;
    let allowDangerouslySkipPermissions = false;
    if (options.dangerouslySkipPermissions) {
      permissionMode = "bypassPermissions";
      allowDangerouslySkipPermissions = true;
    }

    const body: Record<string, unknown> = {
      message,
      idempotencyKey,
      options: {
        token,
        ...(options.model && { model: options.model }),
        ...(options.systemPrompt && { systemPrompt: options.systemPrompt }),
        ...(options.maxTurns && { maxTurns: parseInt(options.maxTurns, 10) }),
        ...(toolsValue !== undefined && { tools: toolsValue }),
        ...(options.allowedTools && { allowedTools: options.allowedTools.split(",").map((t) => t.trim()) }),
        ...(options.disallowedTools && { disallowedTools: options.disallowedTools.split(",").map((t) => t.trim()) }),
        ...(permissionMode && { permissionMode }),
        ...(allowDangerouslySkipPermissions && { allowDangerouslySkipPermissions }),
      },
    };

    if (options.ttl) {
      body.ttl = parseInt(options.ttl, 10);
    }

    if (options.callbackUrl) {
      body.callback = {
        url: options.callbackUrl,
        ...(options.callbackSecret && { secret: options.callbackSecret }),
      };
    }

    // Call incubate endpoint
    const response = await fetch(`${workerUrl}/incubate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as IncubateResponse;

    if (!response.ok) {
      throw new Error(data.message || data.error || `Request failed: ${response.status}`);
    }

    spinner.succeed(`Job created: ${data.vesselId}`);

    console.log(chalk.dim(`\nIdempotency Key: ${data.idempotencyKey}`));
    console.log(chalk.dim(`Status: ${data.status}`));
    if (data.scheduledFor) {
      console.log(chalk.dim(`Scheduled for: ${data.scheduledFor}`));
    }

    console.log(chalk.dim(`\nTrack with: chucky jobs get ${data.vesselId}`));

    // --apply implies --wait
    const shouldWait = options.wait || options.apply;

    // Wait for completion if requested
    if (shouldWait) {
      console.log();
      const completedJob = await waitForJob(data.vesselId);

      // Apply changes if requested and job succeeded
      if (options.apply && completedJob?.isSuccess) {
        console.log();
        await applyJobChanges(data.vesselId);
      }
    }
  } catch (error) {
    spinner.fail("Failed to create job");
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

async function applyJobChanges(jobId: string): Promise<void> {
  const apiKey = requireApiKey();
  const projectConfig = loadProjectConfig();
  const api = new ChuckyApi(apiKey);

  const folder = projectConfig?.folder || ".";
  const fullPath = resolve(folder);
  const branchName = `chucky/job-${jobId.replace(/^run_/, "")}`;
  const shortId = jobId.slice(0, 12);

  let bundlePath: string | null = null;

  const spinner = ora("Waiting for bundle...").start();

  try {
    // Check if branch already exists
    if (branchExists(fullPath, branchName)) {
      spinner.warn(`Branch '${branchName}' already exists, skipping apply`);
      return;
    }

    // Wait for bundle to be available (it's uploaded asynchronously after result)
    let bundleInfo: { downloadUrl: string; hasChanges: boolean } | null = null;
    const maxRetries = 15;  // Jobs may take longer to finalize
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        bundleInfo = await api.getJobBundle(jobId);
        break; // Success
      } catch (error) {
        const isNotFound = (error as Error).message.includes("not found") ||
                          (error as Error).message.includes("No bundle");
        if (isNotFound && attempt < maxRetries) {
          spinner.text = `Waiting for bundle... (${attempt}/${maxRetries})`;
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        } else {
          throw error;
        }
      }
    }

    if (!bundleInfo) {
      spinner.warn("Bundle not available yet, run 'chucky fetch' manually later");
      return;
    }

    if (!bundleInfo.hasChanges) {
      spinner.succeed("Job completed with no file changes");
      return;
    }

    spinner.text = "Downloading bundle...";

    // Download bundle
    bundlePath = join(tmpdir(), `chucky-bundle-${jobId}.bundle`);
    const response = await fetch(bundleInfo.downloadUrl);

    if (!response.ok || !response.body) {
      spinner.fail("Failed to download bundle");
      console.log(chalk.red("Failed to download bundle from server"));
      return;
    }

    const fileStream = createWriteStream(bundlePath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);

    spinner.text = "Verifying bundle...";

    // Verify bundle
    if (!verifyBundle(fullPath, bundlePath)) {
      spinner.fail("Bundle verification failed");
      console.log(chalk.red("Bundle verification failed. The bundle may be corrupted."));
      return;
    }

    spinner.text = "Fetching to branch...";

    // Fetch to temp branch
    fetchBundle(fullPath, bundlePath, branchName);

    spinner.text = "Applying changes...";

    // Apply to working directory (with merge fallback)
    let result: { commits: number; files: number };
    try {
      result = applyBranch(fullPath, branchName);
    } catch (ffError) {
      const errorMsg = (ffError as Error).message || "";
      if (errorMsg.includes("fast-forward") || errorMsg.includes("diverging") || errorMsg.includes("Not possible")) {
        spinner.text = "Merging changes...";
        result = applyBranch(fullPath, branchName, { force: true });
      } else {
        throw ffError;
      }
    }

    spinner.succeed(`Applied ${result.commits} commit(s) with ${result.files} file(s) changed`);

    console.log(chalk.dim(`\nChanges from job ${shortId} have been applied to your working directory.`));
    console.log(chalk.dim(`Branch '${branchName}' contains the original commits.`));
  } catch (error) {
    spinner.fail("Apply failed");
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    console.log(chalk.dim(`\nYou can manually run: chucky fetch ${jobId} && chucky apply ${jobId}`));
  } finally {
    // Clean up temp file
    if (bundlePath) {
      try {
        await unlink(bundlePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

async function waitForJob(jobId: string): Promise<Job | null> {
  const spinner = ora("Waiting for job to complete...").start();
  const apiKey = requireApiKey();
  const api = new ChuckyApi(apiKey);
  const startTime = Date.now();
  const maxWaitMs = 600000; // 10 minutes

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { job } = await api.getJob(jobId);

      if (job.isCompleted) {
        if (job.isSuccess) {
          spinner.succeed("Job completed successfully");
        } else if (job.isFailed) {
          spinner.fail("Job failed");
        } else {
          spinner.info(`Job finished with status: ${job.status}`);
        }

        console.log(chalk.dim(`\nDuration: ${formatDuration(job.startedAt, job.finishedAt)}`));
        return job;
      }

      spinner.text = `Waiting for job... (${job.status})`;
    } catch {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  spinner.warn("Timeout waiting for job completion");
  console.log(chalk.dim(`\nJob is still running. Check status with: chucky jobs get ${jobId}`));
  return null;
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
    .option("--json", "Output raw JSON response")
    .action(getJob);

  cmd
    .command("cancel <jobId>")
    .description("Cancel a running job")
    .action(cancelJob);

  cmd
    .command("create <message>")
    .description("Create a new background job")
    .option("-m, --model <model>", "Model to use (e.g., claude-sonnet-4-5-20250929)")
    .option("-s, --system-prompt <prompt>", "System prompt")
    .option("--max-turns <n>", "Maximum conversation turns")
    .option("--callback-url <url>", "Webhook URL for result delivery")
    .option("--callback-secret <secret>", "Secret for webhook HMAC signature")
    .option("--ttl <seconds>", "Delay execution by N seconds")
    .option("-w, --wait", "Wait for job completion")
    .option("-a, --apply", "Wait for completion and apply changes (implies --wait)")
    // SDK options
    .option("--tools <tools>", 'Tools config (JSON or comma-separated names)')
    .option("--allowed-tools <tools>", "Comma-separated list of allowed tools")
    .option("--disallowed-tools <tools>", "Comma-separated list of disallowed tools")
    .option("--permission-mode <mode>", "Permission mode (bypassPermissions, default, etc.)")
    .option("--dangerously-skip-permissions", "Bypass all permission checks")
    .action(createJob);

  return cmd;
}
