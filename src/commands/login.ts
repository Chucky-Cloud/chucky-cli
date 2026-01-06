import { select, password } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { exec } from "node:child_process";
import { saveGlobalConfig, loadGlobalConfig, getPortalUrl } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";

// Portal frontend URL (for browser-based auth)
const PORTAL_FRONTEND_URL = "https://app.chucky.cloud";

// Open URL in default browser
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.log(chalk.yellow(`\nCouldn't open browser automatically.`));
      console.log(chalk.dim(`Please open this URL manually: ${url}`));
    }
  });
}

// Poll for device code authorization
async function pollForToken(
  portalUrl: string,
  code: string,
  expiresInSeconds: number
): Promise<{ apiKey: string; email: string } | null> {
  const pollInterval = 2000; // 2 seconds
  const maxAttempts = Math.ceil((expiresInSeconds * 1000) / pollInterval);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${portalUrl}/api/device/token?code=${encodeURIComponent(code)}`);
      const result = await response.json();

      if (result.status === "authorized") {
        return { apiKey: result.apiKey, email: result.email };
      }

      if (result.status === "expired") {
        return null;
      }

      // Still pending, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch {
      // Network error, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  return null;
}

export async function loginCommand(options: { key?: string }): Promise<void> {
  console.log(chalk.bold("\n🔐 Chucky CLI Login\n"));

  // Check if already logged in
  const existingConfig = loadGlobalConfig();
  if (existingConfig?.apiKey) {
    console.log(chalk.dim(`Currently logged in as: ${existingConfig.email || "unknown"}`));
  }

  // Choose login method
  const method = options.key
    ? "key"
    : await select({
        message: "How would you like to authenticate?",
        choices: [
          {
            name: "Browser (recommended)",
            value: "browser",
            description: "Opens browser to sign in with your account",
          },
          {
            name: "API Key",
            value: "key",
            description: "Enter your API key manually",
          },
        ],
      });

  const portalUrl = getPortalUrl();

  if (method === "browser") {
    // Device auth flow
    const spinner = ora("Creating device code...").start();

    try {
      // Create device code
      const codeResponse = await fetch(`${portalUrl}/api/device/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!codeResponse.ok) {
        throw new Error("Failed to create device code");
      }

      const { code, expiresInSeconds } = await codeResponse.json();

      spinner.stop();

      // Display code and open browser
      console.log(chalk.bold("\n📋 Your device code:\n"));
      console.log(chalk.cyan.bold(`   ${code}\n`));
      console.log(chalk.dim("Opening browser to complete authentication..."));
      console.log(chalk.dim(`Code expires in ${Math.floor(expiresInSeconds / 60)} minutes.\n`));

      const connectUrl = `${PORTAL_FRONTEND_URL}/connect?code=${encodeURIComponent(code)}`;
      openBrowser(connectUrl);

      console.log(chalk.dim(`If the browser doesn't open, visit:`));
      console.log(chalk.underline(connectUrl));
      console.log();

      // Poll for authorization
      const pollSpinner = ora("Waiting for authorization...").start();
      const result = await pollForToken(portalUrl, code, expiresInSeconds);

      if (!result) {
        pollSpinner.fail("Authorization timed out or was denied");
        console.log(chalk.red("\nPlease try again with: chucky login"));
        process.exit(1);
      }

      // Save config
      saveGlobalConfig({
        apiKey: result.apiKey,
        email: result.email,
        portalUrl,
      });

      pollSpinner.succeed("Logged in successfully");
      console.log(chalk.green(`\n✅ Welcome, ${result.email}!`));
      console.log(chalk.dim("Config saved to ~/.chucky/config.json\n"));
    } catch (error) {
      spinner.fail("Login failed");
      console.log(chalk.red(`\nError: ${(error as Error).message}`));
      process.exit(1);
    }
  } else {
    // Manual API key entry
    let apiKey = options.key;

    if (!apiKey) {
      apiKey = await password({
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
    }

    const spinner = ora("Validating API key...").start();

    try {
      const api = new ChuckyApi(apiKey);
      const result = await api.validateApiKey();

      if (!result.valid) {
        spinner.fail("Invalid API key");
        console.log(chalk.red(`\nError: ${result.error || "API key validation failed"}`));
        process.exit(1);
      }

      saveGlobalConfig({
        apiKey,
        email: result.email,
        portalUrl,
      });

      spinner.succeed("Logged in successfully");
      console.log(chalk.green(`\n✅ Welcome, ${result.email}!`));
      console.log(chalk.dim(`Credit balance: $${result.credit_balance_usd?.toFixed(2) || "0.00"}`));
      console.log(chalk.dim("Config saved to ~/.chucky/config.json\n"));
    } catch (error) {
      spinner.fail("Login failed");
      console.log(chalk.red(`\nError: ${(error as Error).message}`));
      process.exit(1);
    }
  }
}
