import { input, select, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isLoggedIn, loadGlobalConfig, saveGlobalConfig, saveProjectConfig, isProjectInitialized, } from "../lib/config.js";
import { ChuckyApi } from "../lib/api.js";
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
const GITHUB_ACTION_TEMPLATE = `name: Deploy to Chucky
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Chucky CLI
        run: npm install -g @chucky.cloud/cli

      - name: Deploy workspace
        run: chucky deploy
        env:
          CHUCKY_API_KEY: \${{ secrets.CHUCKY_API_KEY }}
`;
export async function initCommand(options) {
    console.log(chalk.bold("\nInitialize Chucky Project\n"));
    // Check if already initialized
    if (isProjectInitialized()) {
        const overwrite = await confirm({
            message: "Project already initialized. Overwrite?",
            default: false,
        });
        if (!overwrite) {
            console.log(chalk.dim("Aborted."));
            return;
        }
    }
    try {
        const apiKey = await ensureLoggedIn();
        const api = new ChuckyApi(apiKey);
        // Fetch existing projects
        const spinner = ora("Fetching projects...").start();
        const projects = await api.listProjects();
        spinner.stop();
        // Ask: create new or use existing?
        let projectId;
        let projectName;
        let hmacKey;
        if (projects.length > 0) {
            const createOrSelect = await select({
                message: "What would you like to do?",
                choices: [
                    { name: "Create a new project", value: "create" },
                    { name: "Use an existing project", value: "existing" },
                ],
            });
            if (createOrSelect === "existing") {
                const selectedProject = await select({
                    message: "Select a project:",
                    choices: projects.map((p) => ({
                        name: `${p.name} (${p.isActive ? "active" : "inactive"})`,
                        value: p,
                    })),
                });
                projectId = selectedProject.id;
                projectName = selectedProject.name;
                // Get full HMAC key
                const keyInfo = await api.getHmacKey(projectId);
                hmacKey = keyInfo.hmacKey;
            }
            else {
                // Create new project
                const result = await createNewProject(api);
                projectId = result.projectId;
                projectName = result.projectName;
                hmacKey = result.hmacKey;
            }
        }
        else {
            // No existing projects, create new
            const result = await createNewProject(api);
            projectId = result.projectId;
            projectName = result.projectName;
            hmacKey = result.hmacKey;
        }
        // Ask for folder to deploy
        const folder = await input({
            message: "Folder to deploy:",
            default: ".",
            validate: (value) => {
                const fullPath = resolve(value);
                if (!existsSync(fullPath)) {
                    return `Directory does not exist: ${fullPath}`;
                }
                return true;
            },
        });
        // Save project config
        saveProjectConfig({
            projectId,
            projectName,
            folder,
            hmacKey,
        });
        console.log(chalk.green("\nProject config saved to .chucky.json"));
        // Ask about GitHub Actions
        const setupGithubActions = await confirm({
            message: "Setup GitHub Actions for automatic deployment?",
            default: true,
        });
        if (setupGithubActions) {
            await setupGitHubActionsWorkflow();
        }
        console.log(chalk.bold.green("\nProject initialized successfully!"));
        console.log(chalk.dim(`\nNext steps:`));
        console.log(chalk.dim(`  1. Run 'chucky deploy' to deploy your workspace`));
        if (setupGithubActions) {
            console.log(chalk.dim(`  2. Add CHUCKY_API_KEY to your GitHub repository secrets`));
        }
    }
    catch (error) {
        console.log(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
    }
}
async function createNewProject(api) {
    const name = await input({
        message: "Project name:",
        validate: (value) => {
            if (!value.trim())
                return "Project name is required";
            if (value.length > 64)
                return "Project name must be 64 characters or less";
            return true;
        },
    });
    const description = await input({
        message: "Description (optional):",
    });
    // Ask for Anthropic API key
    const setAnthropicKey = await confirm({
        message: "Set Anthropic API key now?",
        default: true,
    });
    let anthropicApiKey;
    if (setAnthropicKey) {
        anthropicApiKey = await password({
            message: "Anthropic API key (sk-ant-...):",
            mask: "*",
            validate: (value) => {
                if (!value)
                    return true; // Optional
                if (!value.startsWith("sk-ant-")) {
                    return "Anthropic API key should start with 'sk-ant-'";
                }
                return true;
            },
        });
    }
    const spinner = ora("Creating project...").start();
    try {
        const result = await api.createProject(name, {
            description: description || undefined,
            anthropicApiKey: anthropicApiKey || undefined,
        });
        spinner.succeed(`Project '${name}' created`);
        return {
            projectId: result.projectId,
            projectName: name,
            hmacKey: result.hmacKey,
        };
    }
    catch (error) {
        spinner.fail("Failed to create project");
        throw error;
    }
}
async function setupGitHubActionsWorkflow() {
    const workflowDir = join(process.cwd(), ".github", "workflows");
    const workflowPath = join(workflowDir, "chucky-deploy.yml");
    // Check if workflow already exists
    if (existsSync(workflowPath)) {
        const overwrite = await confirm({
            message: "GitHub workflow already exists. Overwrite?",
            default: false,
        });
        if (!overwrite) {
            console.log(chalk.dim("Skipping GitHub Actions setup."));
            return;
        }
    }
    // Create directory if needed
    if (!existsSync(workflowDir)) {
        mkdirSync(workflowDir, { recursive: true });
    }
    // Write workflow file
    writeFileSync(workflowPath, GITHUB_ACTION_TEMPLATE);
    console.log(chalk.green(`\nGitHub workflow created: ${workflowPath}`));
    console.log(chalk.yellow("\nImportant: Add CHUCKY_API_KEY to your GitHub repository secrets:"));
    console.log(chalk.dim("  Settings > Secrets and variables > Actions > New repository secret"));
}
//# sourceMappingURL=init.js.map