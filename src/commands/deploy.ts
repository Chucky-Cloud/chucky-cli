import chalk from "chalk";
import ora from "ora";
import crypto from "node:crypto";
import { resolve, join } from "node:path";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import {
  isLoggedIn,
  loadProjectConfig,
  saveGlobalConfig,
  loadGlobalConfig,
} from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
import { createArchive, formatBytes } from "../lib/archive.js";
import { uploadToR2 } from "../lib/r2.js";
import { password } from "@inquirer/prompts";
import { initCommand } from "./init.js";
import { getGitInfo, autoCommit } from "../lib/git.js";
import { ExitCode, exitWithError, output, type OutputOptions } from "../lib/output.js";

const DEFAULT_PORTAL_URL = "https://hidden-owl-118.convex.site";

async function ensureLoggedIn(options: OutputOptions): Promise<string> {
  // Check environment variable first
  const envKey = process.env.CHUCKY_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Check if already logged in
  if (isLoggedIn()) {
    const config = loadGlobalConfig();
    return config!.apiKey;
  }

  // In JSON/quiet mode, don't prompt - just fail
  if (options.json || options.quiet) {
    exitWithError(
      ExitCode.NETWORK_ERROR,
      {
        error: "not_logged_in",
        message: "Not logged in. Run 'chucky login' first or set CHUCKY_API_KEY environment variable.",
      },
      options
    );
  }

  // Guide user through login
  console.log(chalk.yellow("Not logged in. Let's set up your API key first.\n"));

  const apiKey = await password({
    message: "Enter your API key (ak_live_...):",
    mask: "*",
    validate: (value) => {
      if (!value) return "API key is required";
      if (!value.startsWith("ak_live_")) {
        return "API key should start with 'ak_live_'";
      }
      return true;
    },
  });

  // Validate the API key
  const spinner = ora("Validating API key...").start();

  const api = new ChuckyApi(apiKey);
  const result = await api.validateApiKey();

  if (!result.valid) {
    spinner.fail("Invalid API key");
    throw new Error(result.error || "API key validation failed");
  }

  // Save config
  const existingConfig = loadGlobalConfig();
  saveGlobalConfig({
    apiKey,
    email: result.email,
    portalUrl: existingConfig?.portalUrl || DEFAULT_PORTAL_URL,
  });

  spinner.succeed("Logged in successfully");
  console.log(chalk.green(`Welcome, ${result.email}!\n`));

  return apiKey;
}

export interface DeployOptions {
  folder?: string;
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const outputOpts: OutputOptions = {
    json: options.json,
    quiet: options.quiet,
  };

  // Only show header in interactive mode
  if (!options.json && !options.quiet) {
    console.log(chalk.bold("\nDeploying to Chucky\n"));
  }

  let archivePath: string | null = null;
  let chuckyStartPath: string | null = null;

  try {
    // Ensure user is logged in
    const apiKey = await ensureLoggedIn(outputOpts);

    // Check if project is initialized
    let projectConfig = loadProjectConfig();
    if (!projectConfig) {
      if (options.json || options.quiet) {
        exitWithError(
          ExitCode.NOT_FOUND,
          {
            error: "no_project",
            message: "No chucky.json found. Run 'chucky init' first.",
          },
          outputOpts
        );
      }
      console.log(chalk.yellow("No chucky.json found. Let's initialize one.\n"));
      await initCommand({ yes: false });
      projectConfig = loadProjectConfig();
      if (!projectConfig) {
        throw new Error("Project initialization failed");
      }
      console.log(""); // Add spacing
    }

    // Check if project is bound (has .chucky with projectId)
    if (!projectConfig.projectId) {
      if (options.json || options.quiet) {
        exitWithError(
          ExitCode.NOT_FOUND,
          {
            error: "project_not_linked",
            message: "Project not linked. Run 'chucky init' first.",
          },
          outputOpts
        );
      }
      console.log(chalk.yellow("Project not linked. Let's link it to a Chucky project.\n"));
      await initCommand({ yes: false });
      projectConfig = loadProjectConfig();
      if (!projectConfig?.projectId) {
        throw new Error("Project linking failed");
      }
      console.log(""); // Add spacing
    }

    const api = new ChuckyApi(apiKey);

    // Determine folder to deploy
    const folder = options.folder || projectConfig.folder || ".";
    const fullPath = resolve(folder);

    if (!existsSync(fullPath)) {
      exitWithError(
        ExitCode.NOT_FOUND,
        {
          error: "folder_not_found",
          message: `Directory does not exist: ${fullPath}`,
          folder: fullPath,
        },
        outputOpts
      );
    }

    // Git validation
    const gitInfo = getGitInfo(fullPath);

    if (!gitInfo.isRepo) {
      exitWithError(
        ExitCode.NOT_GIT_REPO,
        {
          error: "not_a_git_repo",
          message: `Folder '${folder}' is not a git repository. Initialize with: git init && git add -A && git commit -m "Initial"`,
          folder,
        },
        outputOpts
      );
    }

    if (!gitInfo.isRoot) {
      exitWithError(
        ExitCode.NOT_GIT_REPO,
        {
          error: "nested_repo",
          message: `Folder '${folder}' is part of a parent git repository. The deploy folder must be its own git root.`,
          folder,
        },
        outputOpts
      );
    }

    // Check for uncommitted changes
    if (gitInfo.isDirty) {
      if (options.force) {
        if (!options.json && !options.quiet) {
          console.log(chalk.yellow("Auto-committing uncommitted changes..."));
        }
        autoCommit(fullPath, "Auto-commit before deploy");
      } else {
        exitWithError(
          ExitCode.DIRTY_WORKSPACE,
          {
            error: "dirty_workspace",
            message: "Uncommitted changes in workspace. Use --force to auto-commit.",
            files: gitInfo.dirtyFiles,
          },
          outputOpts
        );
      }
    }

    // Record starting commit
    const startCommit = getGitInfo(fullPath).headCommit;

    // Write .chucky-start file so worker knows the baseline commit
    chuckyStartPath = join(fullPath, ".chucky-start");
    writeFileSync(chuckyStartPath, startCommit, "utf-8");

    if (!options.json && !options.quiet) {
      console.log(chalk.dim(`Project: ${projectConfig.name}`));
      console.log(chalk.dim(`Folder: ${fullPath}`));
      console.log(chalk.dim(`Start commit: ${startCommit.slice(0, 7)}\n`));
    }

    // Step 1: Create archive (include .git)
    const archiveSpinner = options.json || options.quiet ? null : ora("Creating archive...").start();
    const archive = await createArchive(fullPath, { includeGit: true });
    archivePath = archive.path;
    archiveSpinner?.succeed(
      `Archive created (${formatBytes(archive.size)}, ${archive.fileCount} files)`
    );

    // Clean up .chucky-start file (it's in the archive now)
    if (existsSync(chuckyStartPath)) {
      unlinkSync(chuckyStartPath);
    }

    // Step 2: Get upload URL
    const urlSpinner = options.json || options.quiet ? null : ora("Getting upload URL...").start();
    const uploadInfo = await api.getUploadUrl(projectConfig.projectId!);
    urlSpinner?.succeed("Got upload URL");

    // Step 3: Upload to R2
    const uploadSpinner = options.json || options.quiet ? null : ora("Uploading...").start();

    await uploadToR2(uploadInfo, archivePath, (uploaded, total) => {
      if (uploadSpinner) {
        const percent = Math.round((uploaded / total) * 100);
        uploadSpinner.text = `Uploading... ${percent}% (${formatBytes(uploaded)}/${formatBytes(total)})`;
      }
    });

    uploadSpinner?.succeed(`Uploaded to R2 (${uploadInfo.key})`);

    // Step 4: Mark workspace as uploaded
    const syncSpinner = options.json || options.quiet ? null : ora("Finalizing deployment...").start();
    const result = await api.markWorkspaceUploaded(projectConfig.projectId!);
    syncSpinner?.succeed("Deployment complete");

    // Clean up temp file
    if (archivePath && existsSync(archivePath)) {
      unlinkSync(archivePath);
    }

    // Step 6: Sync cron jobs (always sync to clear old ones if removed)
    const cronsToSync = projectConfig.crons || [];
    const cronSpinner =
      options.json || options.quiet
        ? null
        : ora(
            cronsToSync.length > 0
              ? `Syncing ${cronsToSync.length} cron job(s)...`
              : "Syncing cron jobs..."
          ).start();
    try {
      const cronResult = await api.syncCrons(projectConfig.projectId!, cronsToSync);
      if (cronsToSync.length > 0 || cronResult.deleted > 0) {
        cronSpinner?.succeed(
          cronsToSync.length > 0
            ? `Synced ${cronResult.created} cron job(s)` +
                (cronResult.deleted > 0 ? ` (${cronResult.deleted} removed)` : "")
            : `Cleared ${cronResult.deleted} cron job(s)`
        );
      } else {
        cronSpinner?.succeed("No cron jobs to sync");
      }
    } catch (cronError) {
      cronSpinner?.fail(`Failed to sync cron jobs: ${(cronError as Error).message}`);
      // Don't exit - deployment was still successful
    }

    // Output result
    if (options.json || options.quiet) {
      output(
        {
          status: "deployed",
          job_id: result.projectId,
          start_commit: startCommit,
          folder: fullPath,
          project_name: projectConfig.name,
          workspace_key: uploadInfo.key,
        },
        outputOpts
      );
    } else {
      console.log(chalk.bold.green("\nDeployment successful!"));
      console.log(chalk.dim(`\nProject ID: ${result.projectId}`));
      console.log(chalk.dim(`Workspace: ${uploadInfo.key}`));
      console.log(chalk.dim(`Start commit: ${startCommit.slice(0, 7)}`));
      if (cronsToSync.length > 0) {
        console.log(chalk.dim(`Cron jobs: ${cronsToSync.length}`));
      }

      // Get HMAC key for example curl command
      try {
        const hmacInfo = await api.getHmacKey(projectConfig.projectId!);
        printExampleCurlCommand(result.projectId, hmacInfo.hmacKey, projectConfig.name);
      } catch {
        // Silently skip if we can't get HMAC key
      }
    }
  } catch (error) {
    // Clean up temp files on error
    if (archivePath && existsSync(archivePath)) {
      try {
        unlinkSync(archivePath);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (chuckyStartPath && existsSync(chuckyStartPath)) {
      try {
        unlinkSync(chuckyStartPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    if (options.json || options.quiet) {
      exitWithError(
        ExitCode.NETWORK_ERROR,
        {
          error: "deploy_failed",
          message: (error as Error).message,
        },
        outputOpts
      );
    } else {
      console.log(chalk.red(`\nError: ${(error as Error).message}`));
      process.exit(1);
    }
  }
}

/**
 * Generate a JWT token for API access
 */
function generateJwt(projectId: string, hmacKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "example-user",
    iss: projectId,
    exp: now + 3600, // 1 hour
    iat: now,
    budget: {
      ai: 1000000, // 1 USD in microdollars
      compute: 3600000, // 1000 hours in seconds
      window: "hour",
      windowStart: new Date().toISOString().split("T")[0] + "T00:00:00Z",
    },
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", hmacKey)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Print example curl command for the /prompt endpoint
 */
function printExampleCurlCommand(projectId: string, hmacKey: string, projectName: string): void {
  const token = generateJwt(projectId, hmacKey);

  console.log(chalk.bold("\n\nExample API Usage"));
  console.log(chalk.dim("─".repeat(50)));

  console.log(chalk.dim("\nTest it now (token valid for 1 hour):"));
  console.log(chalk.cyan(`
curl -X POST 'https://conjure.chucky.cloud/prompt' \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json' \\
  -d '{
    "message": "Create a nodejs file that generates a random number, execute it and return the value",
    "options": {
      "token": "${token}",
      "model": "claude-sonnet-4-5-20250929",
      "allowDangerouslySkipPermissions": true,
      "permissionMode": "bypassPermissions",
      "systemPrompt": { "type": "preset", "preset": "claude_code" },
      "tools": { "type": "preset", "preset": "claude_code" },
      "outputFormat": {
        "type": "json_schema",
        "schema": {
          "type": "object",
          "properties": {
            "randomNumber": { "type": "number" },
            "filename": { "type": "string" },
            "success": { "type": "boolean" },
            "randomDarkJoke": { "type": "string" }
          },
          "required": ["randomNumber", "filename", "success", "randomDarkJoke"],
          "additionalProperties": false
        }
      }
    }
  }' | jq '.result.structured_output'
`));

  console.log(chalk.dim("Response: { randomNumber: 42, filename: \"...\", success: true, randomDarkJoke: \"...\" }"));

  console.log(chalk.dim("\nGenerate your own tokens (Node.js):"));
  console.log(chalk.cyan(`
import crypto from 'crypto';

const hmacSecret = '${hmacKey}';
const projectId = '${projectId}';

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(\`\${headerB64}.\${payloadB64}\`)
    .digest('base64url');
  return \`\${headerB64}.\${payloadB64}.\${signature}\`;
}

const now = Math.floor(Date.now() / 1000);
const token = signJwt({
  sub: 'your-user-id',
  iss: projectId,
  exp: now + 3600,
  iat: now,
  budget: { ai: 1000000, compute: 3600000, window: 'hour' }
}, hmacSecret);
`));

  console.log(chalk.dim("Project: " + projectName));
  console.log(chalk.dim("Project ID: " + projectId));
  console.log(chalk.dim("HMAC Secret: " + hmacKey));
  console.log(chalk.dim("API Endpoint: https://conjure.chucky.cloud/prompt"));
}
