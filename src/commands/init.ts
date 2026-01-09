import { input, select, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  isLoggedIn,
  loadGlobalConfig,
  saveGlobalConfig,
  saveChuckyConfig,
  saveProjectBinding,
  loadChuckyConfig,
  isProjectBound,
  hasChuckyConfig,
} from "../lib/config.js";
import { ChuckyApi, type Project } from "../lib/api.js";

const DEFAULT_PORTAL_URL = "https://hidden-owl-118.convex.site";

async function ensureLoggedIn(): Promise<string> {
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

/**
 * Check if current directory is a git repo, offer to initialize if not
 */
async function ensureGitRepo(): Promise<void> {
  const gitDir = join(process.cwd(), ".git");

  if (existsSync(gitDir)) {
    return; // Already a git repo
  }

  const initGit = await confirm({
    message: "This folder is not a git repository. Initialize git?",
    default: true,
  });

  if (!initGit) {
    console.log(chalk.yellow("\nWarning: Chucky requires a git repository for deployments."));
    return;
  }

  const spinner = ora("Initializing git repository...").start();

  try {
    execSync("git init", { cwd: process.cwd(), stdio: "pipe" });
    execSync("git add -A", { cwd: process.cwd(), stdio: "pipe" });
    execSync('git commit -m "Initial commit"', { cwd: process.cwd(), stdio: "pipe" });
    spinner.succeed("Git repository initialized with initial commit");
  } catch (error) {
    spinner.fail("Failed to initialize git");
    throw error;
  }
}

export async function initCommand(options: { yes?: boolean }): Promise<void> {
  console.log(chalk.bold("\nInitialize Chucky Project\n"));

  // Ensure we have a git repo
  await ensureGitRepo();

  // Check existing config state
  const existingConfig = loadChuckyConfig();
  const alreadyBound = isProjectBound();

  // If already bound, ask if they want to rebind
  if (alreadyBound) {
    const rebind = await confirm({
      message: "Project already linked to a Chucky project. Re-link to a different project?",
      default: false,
    });

    if (!rebind) {
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

    // If we have a chucky.json (starter kit), show its info
    if (existingConfig) {
      console.log(chalk.dim(`Found chucky.json:`));
      console.log(chalk.dim(`  Name: ${existingConfig.name}`));
      if (existingConfig.description) {
        console.log(chalk.dim(`  Description: ${existingConfig.description}`));
      }
      console.log("");
    }

    // Ask: create new or use existing?
    let projectId: string;

    if (projects.length > 0) {
      const createOrSelect = await select({
        message: "What would you like to do?",
        choices: [
          { name: "Create a new project", value: "create" },
          { name: "Link to an existing project", value: "existing" },
        ],
      });

      if (createOrSelect === "existing") {
        const selectedProject = await select<Project>({
          message: "Select a project:",
          choices: projects.map((p) => ({
            name: `${p.name} (${p.isActive ? "active" : "inactive"})`,
            value: p,
          })),
        });

        projectId = selectedProject.id;

        // If no chucky.json exists, create one with selected project's info
        if (!existingConfig) {
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

          saveChuckyConfig({
            name: selectedProject.name,
            folder,
          });
          console.log(chalk.green("\nCreated chucky.json"));
        }
      } else {
        // Create new project (use name/description from chucky.json if available)
        const result = await createNewProject(api, existingConfig);
        projectId = result.projectId;

        // If no chucky.json exists, create one
        if (!existingConfig) {
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

          saveChuckyConfig({
            name: result.projectName,
            description: result.description,
            folder,
          });
          console.log(chalk.green("\nCreated chucky.json"));
        }
      }
    } else {
      // No existing projects, create new
      const result = await createNewProject(api, existingConfig);
      projectId = result.projectId;

      // If no chucky.json exists, create one
      if (!existingConfig) {
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

        saveChuckyConfig({
          name: result.projectName,
          description: result.description,
          folder,
        });
        console.log(chalk.green("\nCreated chucky.json"));
      }
    }

    // Save project binding (.chucky - gitignored)
    saveProjectBinding({ projectId });
    console.log(chalk.green("Created .chucky (add to .gitignore)"));

    // Ask about GitHub Actions
    const setupGithubActions = await confirm({
      message: "Setup GitHub Actions for automatic deployment?",
      default: true,
    });

    if (setupGithubActions) {
      await setupGitHubActionsWorkflow();
    }

    // Offer to add .chucky to .gitignore
    await ensureGitignore();

    console.log(chalk.bold.green("\nProject initialized successfully!"));
    console.log(chalk.dim(`\nNext steps:`));
    console.log(chalk.dim(`  1. Run 'chucky deploy' to deploy your workspace`));
    if (setupGithubActions) {
      console.log(
        chalk.dim(
          `  2. Add CHUCKY_API_KEY to your GitHub repository secrets`
        )
      );
    }
  } catch (error) {
    console.log(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

interface ChuckyConfigPartial {
  name?: string;
  description?: string;
  folder?: string;
}

async function createNewProject(
  api: ChuckyApi,
  existingConfig?: ChuckyConfigPartial | null
): Promise<{ projectId: string; projectName: string; description?: string }> {
  // Use name from chucky.json if available, otherwise ask
  let name: string;
  if (existingConfig?.name) {
    const useName = await confirm({
      message: `Use project name from chucky.json: "${existingConfig.name}"?`,
      default: true,
    });
    if (useName) {
      name = existingConfig.name;
    } else {
      name = await input({
        message: "Project name:",
        validate: (value) => {
          if (!value.trim()) return "Project name is required";
          if (value.length > 64) return "Project name must be 64 characters or less";
          return true;
        },
      });
    }
  } else {
    name = await input({
      message: "Project name:",
      validate: (value) => {
        if (!value.trim()) return "Project name is required";
        if (value.length > 64) return "Project name must be 64 characters or less";
        return true;
      },
    });
  }

  // Use description from chucky.json if available, otherwise ask
  let description: string | undefined;
  if (existingConfig?.description) {
    description = existingConfig.description;
    console.log(chalk.dim(`  Using description: ${description}`));
  } else {
    description = await input({
      message: "Description (optional):",
    }) || undefined;
  }

  // Ask for Anthropic API key
  const setAnthropicKey = await confirm({
    message: "Set Anthropic API key now?",
    default: true,
  });

  let anthropicApiKey: string | undefined;
  if (setAnthropicKey) {
    anthropicApiKey = await password({
      message: "Anthropic API key (sk-ant-...):",
      mask: "*",
      validate: (value) => {
        if (!value) return true; // Optional
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
      description,
      anthropicApiKey: anthropicApiKey || undefined,
    });

    spinner.succeed(`Project '${name}' created`);

    return {
      projectId: result.projectId,
      projectName: name,
      description,
    };
  } catch (error) {
    spinner.fail("Failed to create project");
    throw error;
  }
}

async function setupGitHubActionsWorkflow(): Promise<void> {
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
  console.log(
    chalk.yellow(
      "\nImportant: Add CHUCKY_API_KEY to your GitHub repository secrets:"
    )
  );
  console.log(
    chalk.dim("  Settings > Secrets and variables > Actions > New repository secret")
  );
}

async function ensureGitignore(): Promise<void> {
  const gitignorePath = join(process.cwd(), ".gitignore");
  const entry = ".chucky";

  // Check if .gitignore exists
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");

    // Check if .chucky is already in .gitignore
    if (content.includes(entry)) {
      return; // Already there
    }

    // Ask to add
    const addToGitignore = await confirm({
      message: "Add .chucky to .gitignore?",
      default: true,
    });

    if (addToGitignore) {
      appendFileSync(gitignorePath, `\n# Chucky project binding (contains projectId)\n${entry}\n`);
      console.log(chalk.green("Added .chucky to .gitignore"));
    }
  } else {
    // No .gitignore, ask to create
    const createGitignore = await confirm({
      message: "Create .gitignore with .chucky?",
      default: true,
    });

    if (createGitignore) {
      writeFileSync(gitignorePath, `# Chucky project binding (contains projectId)\n${entry}\n`);
      console.log(chalk.green("Created .gitignore with .chucky"));
    }
  }
}
