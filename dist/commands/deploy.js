import chalk from "chalk";
import ora from "ora";
import crypto from "node:crypto";
import { resolve } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { isLoggedIn, loadProjectConfig, saveGlobalConfig, loadGlobalConfig, } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
import { createArchive, formatBytes } from "../lib/archive.js";
import { uploadToR2 } from "../lib/r2.js";
import { password } from "@inquirer/prompts";
import { initCommand } from "./init.js";
const DEFAULT_PORTAL_URL = "https://hidden-owl-118.convex.site";
async function ensureLoggedIn() {
    // Check environment variable first
    const envKey = process.env.CHUCKY_API_KEY;
    if (envKey) {
        return envKey;
    }
    // Check if already logged in
    if (isLoggedIn()) {
        const config = loadGlobalConfig();
        return config.apiKey;
    }
    // Guide user through login
    console.log(chalk.yellow("Not logged in. Let's set up your API key first.\n"));
    const apiKey = await password({
        message: "Enter your API key (ak_live_...):",
        mask: "*",
        validate: (value) => {
            if (!value)
                return "API key is required";
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
export async function deployCommand(options) {
    console.log(chalk.bold("\nDeploying to Chucky\n"));
    let archivePath = null;
    try {
        // Ensure user is logged in
        const apiKey = await ensureLoggedIn();
        // Check if project is initialized
        let projectConfig = loadProjectConfig();
        if (!projectConfig) {
            console.log(chalk.yellow("No project configuration found. Let's initialize one.\n"));
            await initCommand({ yes: false });
            projectConfig = loadProjectConfig();
            if (!projectConfig) {
                throw new Error("Project initialization failed");
            }
            console.log(""); // Add spacing
        }
        const api = new ChuckyApi(apiKey);
        // Determine folder to deploy
        const folder = options.folder || projectConfig.folder || ".";
        const fullPath = resolve(folder);
        if (!existsSync(fullPath)) {
            console.log(chalk.red(`\nError: Directory does not exist: ${fullPath}`));
            process.exit(1);
        }
        console.log(chalk.dim(`Project: ${projectConfig.projectName}`));
        console.log(chalk.dim(`Folder: ${fullPath}\n`));
        // Step 1: Create archive
        const archiveSpinner = ora("Creating archive...").start();
        const archive = await createArchive(fullPath);
        archivePath = archive.path;
        archiveSpinner.succeed(`Archive created (${formatBytes(archive.size)}, ${archive.fileCount} files)`);
        // Step 2: Get upload URL
        const urlSpinner = ora("Getting upload URL...").start();
        const uploadInfo = await api.getUploadUrl(projectConfig.projectId);
        urlSpinner.succeed("Got upload URL");
        // Step 3: Upload to R2
        const uploadSpinner = ora("Uploading...").start();
        await uploadToR2(uploadInfo, archivePath, (uploaded, total) => {
            const percent = Math.round((uploaded / total) * 100);
            uploadSpinner.text = `Uploading... ${percent}% (${formatBytes(uploaded)}/${formatBytes(total)})`;
        });
        uploadSpinner.succeed(`Uploaded to R2 (${uploadInfo.key})`);
        // Step 4: Mark workspace as uploaded
        const syncSpinner = ora("Finalizing deployment...").start();
        const result = await api.markWorkspaceUploaded(projectConfig.projectId);
        syncSpinner.succeed("Deployment complete");
        // Clean up temp file
        if (archivePath && existsSync(archivePath)) {
            unlinkSync(archivePath);
        }
        console.log(chalk.bold.green("\nDeployment successful!"));
        console.log(chalk.dim(`\nProject UUID: ${result.projectUuid}`));
        console.log(chalk.dim(`Workspace: ${uploadInfo.key}`));
        // Get HMAC key for example curl command
        try {
            const hmacInfo = await api.getHmacKey(projectConfig.projectId);
            printExampleCurlCommand(result.projectUuid, hmacInfo.hmacKey, projectConfig.projectName);
        }
        catch {
            // Silently skip if we can't get HMAC key
        }
    }
    catch (error) {
        // Clean up temp file on error
        if (archivePath && existsSync(archivePath)) {
            try {
                unlinkSync(archivePath);
            }
            catch {
                // Ignore cleanup errors
            }
        }
        console.log(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
    }
}
/**
 * Generate a JWT token for API access
 */
function generateJwt(projectUuid, hmacKey) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: "example-user",
        iss: projectUuid,
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
function printExampleCurlCommand(projectUuid, hmacKey, projectName) {
    const token = generateJwt(projectUuid, hmacKey);
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

const hmacKey = '${hmacKey}';
const projectUuid = '${projectUuid}';

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
  iss: projectUuid,
  exp: now + 3600,
  iat: now,
  budget: { ai: 1000000, compute: 3600000, window: 'hour' }
}, hmacKey);
`));
    console.log(chalk.dim("Project: " + projectName));
    console.log(chalk.dim("HMAC Key: " + hmacKey));
    console.log(chalk.dim("API Endpoint: https://conjure.chucky.cloud/prompt"));
}
//# sourceMappingURL=deploy.js.map